import type { EmbeddingProvider, LLMProvider } from '../../server/lib/ai/types'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { givenVerifiedUser } from '@base/testing/auth'
import { test } from '@base/testing/test'
import { afterAll, afterEach, describe, expect } from 'vitest'
import { parseAgtype, queryCypher } from '../../server/lib/graph'
import { PIPELINES } from '../../server/lib/pipeline/ids'
import { createStageRegistry } from '../../server/lib/pipeline/singleton'
import { StoreGraphStage } from '../../server/lib/pipeline/stages/store-graph'
import { ingestNote } from '../../server/lib/sync/ingest'
import { syncedFolderEvents } from '../../server/lib/sync/synced-folders'
import { ensureNotesGraphCatalog } from './age-catalog'

const tempDirs: string[] = []

function givenTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aso-synced-folders-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  syncedFolderEvents.removeAllListeners()
})

afterAll(() => {
  for (const dir of tempDirs)
    rmSync(dir, { recursive: true, force: true })
})

async function postFolder(server: any, cookies: string, folderPath: string): Promise<Response> {
  return server('/api/synced-folders', {
    method: 'POST',
    headers: { 'cookie': cookies, 'content-type': 'application/json' },
    body: JSON.stringify({ path: folderPath }),
  })
}

async function addFolder(server: any, cookies: string, folderPath: string) {
  const res = await postFolder(server, cookies, folderPath)
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.id).toBeTruthy()
  expect(body.path).toBe(path.resolve(folderPath))
  return body
}

function stubEmbeddingProvider() {
  const provider: EmbeddingProvider = {
    async embed(texts) {
      return texts.map(() => Array.from({ length: 2048 }).fill(0.01))
    },
  }
  return { provider }
}

function stubLLM(payload: object) {
  const provider: LLMProvider = {
    async complete() {
      return { message: { role: 'assistant', content: JSON.stringify(payload) } }
    },
  }
  return { provider }
}

async function givenNote(trx: any, workspaceId: string, syncedFolderId: string, path: string, content: string) {
  return trx
    .insertInto('notes')
    .values({
      workspace_id: workspaceId,
      synced_folder_id: syncedFolderId,
      path,
      title: path,
      content,
      content_hash: `hash-${path}`,
      pipeline: 'markdown-note-with-links',
    })
    .returning(['id', 'content_hash'])
    .executeTakeFirstOrThrow()
}

async function ingest(trx: any, noteId: string, extraction: object) {
  const embedding = stubEmbeddingProvider()
  const llm = stubLLM(extraction)
  const registry = createStageRegistry({ llmProvider: llm.provider, embeddingProvider: embedding.provider })
  registry.register(new StoreGraphStage(embedding.provider))
  await ingestNote({ db: trx, noteId, options: { registry, pipelines: PIPELINES } })
}

function noteContent(body: string): string {
  return `# Note\n\n${`${body} `.repeat(200)}`
}

async function rowCount(trx: any, table: string, where?: (q: any) => any): Promise<number> {
  let q = trx.selectFrom(table).select((eb: any) => eb.fn.count('id').as('c'))
  if (where)
    q = where(q)
  const row = await q.executeTakeFirstOrThrow()
  return Number(row.c ?? 0)
}

async function cypherStrings(trx: any, query: string, column: string): Promise<string[]> {
  const rows = await queryCypher<Record<string, unknown>>(trx, query, `${column} ag_catalog.agtype`)
  return rows.map(row => String(parseAgtype(row[column])))
}

describe('synced-folders API', () => {
  describe('gET /api/synced-folders', () => {
    test('returns 401 when unauthenticated', async ({ server }) => {
      const res = await server('/api/synced-folders')
      expect(res.status).toBe(401)
    })

    test('returns an empty list for a fresh workspace', async ({ server }) => {
      const { cookies } = await givenVerifiedUser()
      const res = await server('/api/synced-folders', { headers: { cookie: cookies } })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual([])
    })
  })

  describe('pOST /api/synced-folders', () => {
    test('returns 401 when unauthenticated', async ({ server }) => {
      const res = await postFolder(server, '', '/tmp/fake')
      expect(res.status).toBe(401)
    })

    test('creates a synced folder for an existing directory and emits an in-process add event', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      const dir = givenTempDir()
      mkdirSync(path.join(dir, 'nested'), { recursive: true })

      let emitted: unknown = null
      syncedFolderEvents.once('added', (event) => {
        emitted = event
      })

      const body = await addFolder(server, cookies, dir)

      const row = await trx
        .selectFrom('synced_folders')
        .selectAll()
        .where('id', '=', body.id)
        .executeTakeFirstOrThrow()
      expect(row.workspace_id).toBe(workspace.id)
      expect(row.path).toBe(path.resolve(dir))

      expect(emitted).toMatchObject({
        workspaceId: workspace.id,
        syncedFolderId: body.id,
        path: path.resolve(dir),
      })
    })

    test('returns note counts in the list response', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      const dir = givenTempDir()
      const body = await addFolder(server, cookies, dir)

      await trx
        .insertInto('notes')
        .values({
          workspace_id: workspace.id,
          synced_folder_id: body.id,
          path: '/x.md',
          title: 'x',
          content_hash: 'h',
          status: 'pending',
        })
        .execute()

      const res = await server('/api/synced-folders', { headers: { cookie: cookies } })
      expect(res.status).toBe(200)
      const list = await res.json()
      expect(list).toHaveLength(1)
      expect(list[0]).toMatchObject({ id: body.id, path: body.path, noteCount: 1 })
    })

    test('rejects a relative path', async ({ server }) => {
      const { cookies } = await givenVerifiedUser()
      const res = await postFolder(server, cookies, 'relative/path')
      expect(res.status).toBe(400)
    })

    test('rejects a non-existent path', async ({ server }) => {
      const { cookies } = await givenVerifiedUser()
      const res = await postFolder(server, cookies, '/tmp/definitely-does-not-exist-12345')
      expect(res.status).toBe(400)
    })

    test('rejects a file path', async ({ server }) => {
      const { cookies } = await givenVerifiedUser()
      const dir = givenTempDir()
      const file = path.join(dir, 'not-a-dir.txt')
      writeFileSync(file, 'x')
      const res = await postFolder(server, cookies, file)
      expect(res.status).toBe(400)
    })

    test('rejects a duplicate path', async ({ server }) => {
      const { cookies } = await givenVerifiedUser()
      const dir = givenTempDir()
      await addFolder(server, cookies, dir)
      const res = await postFolder(server, cookies, dir)
      expect(res.status).toBe(409)
    })

    test('rejects a folder nested inside an existing synced folder', async ({ server }) => {
      const { cookies } = await givenVerifiedUser()
      const root = givenTempDir()
      const nested = path.join(root, 'nested')
      mkdirSync(nested, { recursive: true })
      await addFolder(server, cookies, root)
      const res = await postFolder(server, cookies, nested)
      expect(res.status).toBe(409)
    })

    test('rejects a folder that contains an existing synced folder', async ({ server }) => {
      const { cookies } = await givenVerifiedUser()
      const root = givenTempDir()
      const nested = path.join(root, 'nested')
      mkdirSync(nested, { recursive: true })
      await addFolder(server, cookies, nested)
      const res = await postFolder(server, cookies, root)
      expect(res.status).toBe(409)
    })
  })

  describe('dELETE /api/synced-folders/:id', () => {
    test('returns 401 when unauthenticated', async ({ server }) => {
      const { cookies } = await givenVerifiedUser()
      const dir = givenTempDir()
      const body = await addFolder(server, cookies, dir)

      const res = await server(`/api/synced-folders/${body.id}`, { method: 'DELETE' })
      expect(res.status).toBe(401)
    })

    test('deletes an empty synced folder and emits a remove event', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      const dir = givenTempDir()
      const body = await addFolder(server, cookies, dir)

      let emitted: unknown = null
      syncedFolderEvents.once('removed', (event) => {
        emitted = event
      })

      const res = await server(`/api/synced-folders/${body.id}`, {
        method: 'DELETE',
        headers: { cookie: cookies },
      })
      expect(res.status).toBe(200)
      const summary = await res.json()
      expect(summary).toMatchObject({ notes: 0, concepts: 0, topics: 0 })

      const row = await trx
        .selectFrom('synced_folders')
        .selectAll()
        .where('id', '=', body.id)
        .executeTakeFirst()
      expect(row).toBeUndefined()

      expect(emitted).toMatchObject({
        workspaceId: workspace.id,
        syncedFolderId: body.id,
      })
    })

    test('wipes the synced folder notes and garbage-collects orphaned graph rows, preserving shared rows', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      await ensureNotesGraphCatalog(trx)

      const dirA = givenTempDir()
      const dirB = givenTempDir()
      const folderA = await addFolder(server, cookies, dirA)
      const folderB = await addFolder(server, cookies, dirB)

      const noteA = await givenNote(trx, workspace.id, folderA.id, '/a.md', noteContent('alpha'))
      const noteB = await givenNote(trx, workspace.id, folderB.id, '/b.md', noteContent('beta'))

      await ingest(trx, noteA.id, {
        concepts: [
          { name: 'Shared Concept', description: 'shared across folders', topics: ['Topic A'] },
          { name: 'Folder1 Exclusive', description: 'only in folder 1', topics: ['Topic A'] },
        ],
        relations: [{ from: 'Shared Concept', to: 'Folder1 Exclusive', type: 'contains' }],
        mentions: [
          { concept: 'Shared Concept', chunkRefs: [0] },
          { concept: 'Folder1 Exclusive', chunkRefs: [0] },
        ],
        tags: ['ai-tag'],
        topics: [{ name: 'Topic A', description: 'topic a' }],
      })

      await ingest(trx, noteB.id, {
        concepts: [
          { name: 'Shared Concept', description: 'shared across folders', topics: ['Topic A'] },
          { name: 'Folder2 Exclusive', description: 'only in folder 2', topics: ['Topic A'] },
        ],
        relations: [{ from: 'Shared Concept', to: 'Folder2 Exclusive', type: 'relates-to' }],
        mentions: [
          { concept: 'Shared Concept', chunkRefs: [0] },
          { concept: 'Folder2 Exclusive', chunkRefs: [0] },
        ],
        tags: [],
        topics: [{ name: 'Topic A', description: 'topic a' }],
      })

      const conceptIdsBefore = await trx
        .selectFrom('concepts')
        .select(['id', 'name'])
        .where('workspace_id', '=', workspace.id)
        .execute()
      const conceptIdByName = new Map(conceptIdsBefore.map(c => [c.name, c.id]))

      const userTag = await trx
        .insertInto('tags')
        .values({ workspace_id: workspace.id, name: 'user-tag', name_normalized: 'user-tag' })
        .returning('id')
        .executeTakeFirstOrThrow()
      await trx
        .insertInto('note_tags')
        .values({ workspace_id: workspace.id, note_id: noteA.id, tag_id: userTag.id, origin: 'user' })
        .execute()
      await trx
        .insertInto('note_tag_dismissals')
        .values({ workspace_id: workspace.id, note_id: noteA.id, tag_id: userTag.id })
        .execute()

      const res = await server(`/api/synced-folders/${folderA.id}`, {
        method: 'DELETE',
        headers: { cookie: cookies },
      })
      expect(res.status).toBe(200)
      const summary = await res.json()
      expect(summary).toMatchObject({
        notes: 1,
        concepts: 1,
        relations: 1,
        topics: 0,
        aiNoteTags: 1,
        userNoteTags: 1,
        tagDismissals: 1,
      })

      // folder A's note and derived rows are gone
      const noteARow = await trx
        .selectFrom('notes')
        .select('id')
        .where('id', '=', noteA.id)
        .executeTakeFirst()
      expect(noteARow).toBeUndefined()
      expect(await rowCount(trx, 'chunks', (q: any) => q.where('note_id', '=', noteA.id))).toBe(0)

      // folder B's data is untouched
      const noteBRow = await trx
        .selectFrom('notes')
        .select('id')
        .where('id', '=', noteB.id)
        .executeTakeFirstOrThrow()
      expect(noteBRow.id).toBe(noteB.id)
      expect(await rowCount(trx, 'chunks', (q: any) => q.where('note_id', '=', noteB.id))).toBeGreaterThan(0)

      // shared concept survives; exclusive concept is gone
      expect(await rowCount(trx, 'concepts', (q: any) => q.where('name', '=', 'Shared Concept'))).toBe(1)
      expect(await rowCount(trx, 'concepts', (q: any) => q.where('name', '=', 'Folder1 Exclusive'))).toBe(0)
      expect(await rowCount(trx, 'concepts')).toBe(2)

      // topic A survives because folder B still links to it
      expect(await rowCount(trx, 'topics')).toBe(1)

      // folder1's relation is gone, folder2's relation remains
      expect(await rowCount(trx, 'relations')).toBe(1)

      // AGE mirror: folder A note, exclusive concept and relation removed; shared/topic remain
      const noteAVertices = await cypherStrings(
        trx,
        `MATCH (n:Note {id: '${noteA.id}'}) RETURN n.id`,
        'id',
      )
      expect(noteAVertices).toHaveLength(0)

      const noteBVertices = await cypherStrings(
        trx,
        `MATCH (n:Note {id: '${noteB.id}'}) RETURN n.id`,
        'id',
      )
      expect(noteBVertices).toHaveLength(1)

      const exclusiveConceptVertices = await cypherStrings(
        trx,
        `MATCH (c:Concept {id: '${conceptIdByName.get('Folder1 Exclusive')}'}) RETURN c.id`,
        'id',
      )
      expect(exclusiveConceptVertices).toHaveLength(0)

      const sharedConceptVertices = await cypherStrings(
        trx,
        `MATCH (c:Concept {id: '${conceptIdByName.get('Shared Concept')}'}) RETURN c.id`,
        'id',
      )
      expect(sharedConceptVertices).toHaveLength(1)

      const topicVertices = await cypherStrings(
        trx,
        `MATCH (t:Topic {workspace_id: '${workspace.id}'}) RETURN t.name ORDER BY t.name`,
        'name',
      )
      expect(topicVertices).toEqual(['Topic A'])
    })

    test('deletes a synced folder with no notes and returns zero counts', async ({ server, trx }) => {
      const { cookies } = await givenVerifiedUser()
      const dir = givenTempDir()
      const body = await addFolder(server, cookies, dir)

      const res = await server(`/api/synced-folders/${body.id}`, {
        method: 'DELETE',
        headers: { cookie: cookies },
      })
      expect(res.status).toBe(200)
      const summary = await res.json()
      expect(summary).toMatchObject({ notes: 0, chunks: 0, mentions: 0, concepts: 0, relations: 0, topics: 0 })

      const row = await trx
        .selectFrom('synced_folders')
        .select('id')
        .where('id', '=', body.id)
        .executeTakeFirst()
      expect(row).toBeUndefined()
    })

    test('returns 404 for an unknown synced folder id', async ({ server }) => {
      const { cookies } = await givenVerifiedUser()
      const res = await server(`/api/synced-folders/${crypto.randomUUID()}`, {
        method: 'DELETE',
        headers: { cookie: cookies },
      })
      expect(res.status).toBe(404)
    })
  })

  describe('pATCH /api/synced-folders/:id', () => {
    async function patchAlias(server: any, cookies: string, id: string, alias: string | null) {
      return server(`/api/synced-folders/${id}`, {
        method: 'PATCH',
        headers: { 'cookie': cookies, 'content-type': 'application/json' },
        body: JSON.stringify({ alias }),
      })
    }

    test('returns 401 when unauthenticated', async ({ server }) => {
      const { cookies } = await givenVerifiedUser()
      const dir = givenTempDir()
      const body = await addFolder(server, cookies, dir)

      const res = await patchAlias(server, '', body.id, 'Work')
      expect(res.status).toBe(401)
    })

    test('updates the alias in the response and the database, trimmed', async ({ server, trx }) => {
      const { cookies } = await givenVerifiedUser()
      const dir = givenTempDir()
      const body = await addFolder(server, cookies, dir)

      const res = await patchAlias(server, cookies, body.id, '  Work Plans  ')
      expect(res.status).toBe(200)
      const updated = await res.json()
      expect(updated).toMatchObject({ id: body.id, path: body.path, alias: 'Work Plans' })

      const row = await trx
        .selectFrom('synced_folders')
        .select('alias')
        .where('id', '=', body.id)
        .executeTakeFirstOrThrow()
      expect(row.alias).toBe('Work Plans')
    })

    test('clears the alias to null when patched with an empty string', async ({ server, trx }) => {
      const { cookies } = await givenVerifiedUser()
      const dir = givenTempDir()
      const body = await addFolder(server, cookies, dir)
      await patchAlias(server, cookies, body.id, 'Work')

      const res = await patchAlias(server, cookies, body.id, '   ')
      expect(res.status).toBe(200)
      const updated = await res.json()
      expect(updated.alias).toBeNull()

      const row = await trx
        .selectFrom('synced_folders')
        .select('alias')
        .where('id', '=', body.id)
        .executeTakeFirstOrThrow()
      expect(row.alias).toBeNull()
    })

    test('rejects an alias longer than 80 characters', async ({ server }) => {
      const { cookies } = await givenVerifiedUser()
      const dir = givenTempDir()
      const body = await addFolder(server, cookies, dir)

      const res = await patchAlias(server, cookies, body.id, 'x'.repeat(81))
      expect(res.status).toBe(400)
    })

    test('returns 404 for a synced folder of another workspace', async ({ server }) => {
      const { cookies } = await givenVerifiedUser()
      const other = await givenVerifiedUser()
      const dir = givenTempDir()
      const body = await addFolder(server, other.cookies, dir)

      const res = await patchAlias(server, cookies, body.id, 'Work')
      expect(res.status).toBe(404)
    })

    test('returns 404 for an unknown synced folder id', async ({ server }) => {
      const { cookies } = await givenVerifiedUser()
      const res = await patchAlias(server, cookies, crypto.randomUUID(), 'Work')
      expect(res.status).toBe(404)
    })
  })
})
