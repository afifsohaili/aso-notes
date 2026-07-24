import type { DB } from '@monorepo/shared'
import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely'
import { describe, expect, it } from 'vitest'
import { createSyncDispatcher } from '../../server/lib/sync/dispatcher'
import { contentHash } from '../../server/lib/sync/hash'
import {
  ancestorFolderPaths,
  FOLDER_COVER_FILENAME,
  folderPathOf,
  isFolderCoverPath,
  titleFromPath,
  toNotePath,
} from '../../server/lib/sync/paths'
import { PENDING_SETTLE_INTERVAL, settledPendingNotesQuery } from '../../server/lib/sync/sweeper'
import { decideUpsert } from '../../server/lib/sync/upsert-decision'

/**
 * M3 unit spec: pure sync helpers (plan-002-system §Sync service).
 * Paths use the M1/M2 convention: leading '/', '/' = workspace root,
 * path-string folder model with no parent_id.
 */

describe('toNotePath', () => {
  it('converts an absolute file path to a workspace-relative note path', () => {
    expect(toNotePath('/data/notes', '/data/notes/x.md')).toBe('/x.md')
    expect(toNotePath('/data/notes', '/data/notes/project-a/engineering/x.md')).toBe('/project-a/engineering/x.md')
  })

  it('normalizes a trailing slash on the notes dir', () => {
    expect(toNotePath('/data/notes/', '/data/notes/x.md')).toBe('/x.md')
  })
})

describe('folderPathOf', () => {
  it('returns the immediate parent folder path', () => {
    expect(folderPathOf('/x.md')).toBe('/')
    expect(folderPathOf('/a/x.md')).toBe('/a')
    expect(folderPathOf('/a/b/x.md')).toBe('/a/b')
  })
})

describe('ancestorFolderPaths', () => {
  it('lists every directory level of a note path, root-level first, excluding the root itself', () => {
    expect(ancestorFolderPaths('/project-a/engineering/x.md')).toEqual(['/project-a', '/project-a/engineering'])
  })

  it('is empty for a root-level note (root notes have no folder row — M1)', () => {
    expect(ancestorFolderPaths('/x.md')).toEqual([])
  })
})

describe('isFolderCoverPath', () => {
  it('detects the folder-cover filename at any depth', () => {
    expect(isFolderCoverPath('/__folder-cover.md')).toBe(true)
    expect(isFolderCoverPath('/a/b/__folder-cover.md')).toBe(true)
    expect(isFolderCoverPath('/a/__folder-cover.md.bak')).toBe(false)
    expect(isFolderCoverPath('/a/folder-cover.md')).toBe(false)
    expect(isFolderCoverPath('/a/x.md')).toBe(false)
  })

  it('exposes the canonical cover filename', () => {
    expect(FOLDER_COVER_FILENAME).toBe('__folder-cover.md')
  })
})

describe('titleFromPath', () => {
  it('derives the note title from the filename without extension', () => {
    expect(titleFromPath('/project-a/engineering/my-note.md')).toBe('my-note')
    expect(titleFromPath('/x.md')).toBe('x')
  })
})

describe('contentHash', () => {
  it('is a stable sha256 hex of the content', () => {
    // known vector: sha256('hello world\n')
    expect(contentHash('hello world\n')).toBe('a948904f2f0f479b8f8197694b30184b0d2ed1c1cd2a1ec0fb85d299a192a447')
  })

  it('changes when the content changes', () => {
    expect(contentHash('a')).not.toBe(contentHash('b'))
  })
})

describe('decideUpsert (rename guard + skip rule)', () => {
  const HASH = 'h-new'

  it('inserts when no note exists at the path and no hash match exists', () => {
    expect(decideUpsert({ existingAtPath: null, existingWithHash: null, contentHash: HASH }))
      .toEqual({ kind: 'insert' })
  })

  it('skips when the content hash equals the row\'s ingested_hash (already ingested, unchanged)', () => {
    expect(decideUpsert({
      existingAtPath: { id: 'n1', content_hash: 'h-old', ingested_hash: HASH },
      existingWithHash: null,
      contentHash: HASH,
    })).toEqual({ kind: 'skip' })
  })

  it('skips when the content hash equals the row\'s content_hash (already synced, avoids resetting the settle clock)', () => {
    expect(decideUpsert({
      existingAtPath: { id: 'n1', content_hash: HASH, ingested_hash: 'h-older' },
      existingWithHash: null,
      contentHash: HASH,
    })).toEqual({ kind: 'skip' })
  })

  it('updates when the row at the path has different content', () => {
    expect(decideUpsert({
      existingAtPath: { id: 'n1', content_hash: 'h-old', ingested_hash: 'h-old' },
      existingWithHash: null,
      contentHash: HASH,
    })).toEqual({ kind: 'update', noteId: 'n1' })
  })

  it('renames when the content hash lives on a row at a different path (preserves id, links, status)', () => {
    expect(decideUpsert({
      existingAtPath: null,
      existingWithHash: { id: 'n1' },
      contentHash: HASH,
    })).toEqual({ kind: 'rename', noteId: 'n1' })
  })

  it('prefers the row at the path over a hash match elsewhere', () => {
    expect(decideUpsert({
      existingAtPath: { id: 'n1', content_hash: 'h-old', ingested_hash: 'h-old' },
      existingWithHash: { id: 'n2' },
      contentHash: HASH,
    })).toEqual({ kind: 'update', noteId: 'n1' })
  })
})

describe('createSyncDispatcher', () => {
  it('selects the BullMQ dispatcher when a Redis URL is present', async () => {
    const added: { name: string, data: unknown }[] = []
    const dispatcher = createSyncDispatcher({
      redisUrl: 'redis://localhost:6379',
      createQueue: () => ({ add: async (name, data) => { added.push({ name, data }) } }),
    })
    expect(dispatcher).not.toBeNull()
    await dispatcher!.dispatch('note-1')
    expect(added).toEqual([{ name: 'ingest-note', data: { noteId: 'note-1' } }])
  })

  it('selects the inline dispatcher when no Redis URL but an inline handler is given (tests)', async () => {
    const ran: string[] = []
    const dispatcher = createSyncDispatcher({
      redisUrl: undefined,
      inlineRun: async (noteId) => { ran.push(noteId) },
    })
    expect(dispatcher).not.toBeNull()
    await dispatcher!.dispatch('note-2')
    expect(ran).toEqual(['note-2'])
  })

  it('returns null when no Redis URL and no inline handler (sweeper disabled)', () => {
    expect(createSyncDispatcher({ redisUrl: undefined })).toBeNull()
  })
})

describe('settledPendingNotesQuery', () => {
  it('selects pending notes settled for longer than the settle interval', () => {
    // compile-only: no driver connection is opened
    const db = new Kysely<DB>({
      dialect: {
        createAdapter: () => new PostgresAdapter(),
        createDriver: () => new DummyDriver(),
        createIntrospector: d => new PostgresIntrospector(d),
        createQueryCompiler: () => new PostgresQueryCompiler(),
      },
    })

    const compiled = settledPendingNotesQuery(db, 'ws-1').compile()
    expect(compiled.sql).toContain('"status" =')
    expect(compiled.sql).toContain(`interval '${PENDING_SETTLE_INTERVAL}'`)
    expect(compiled.sql).toMatch(/updated_at"?\s*</)
    expect(compiled.parameters).toContain('ws-1')
    expect(compiled.parameters).toContain('pending')
  })

  it('exposes a 5-minute settle interval per the plan', () => {
    expect(PENDING_SETTLE_INTERVAL).toBe('5 minutes')
  })
})
