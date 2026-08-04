import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { givenVerifiedUser } from '@base/testing/auth'
import { test } from '@base/testing/test'
import { afterAll, describe, expect } from 'vitest'
import { agLiteral, queryCypher } from '../../server/lib/graph/age'
import { mergeNoteNode, mergeTaggedEdge, mergeTagNode } from '../../server/lib/graph/helpers'
import { ensureNotesGraphCatalog } from './age-catalog'

const tempDirs: string[] = []

function givenNotesDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'aso-notes-api-'))
  tempDirs.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tempDirs)
    rmSync(dir, { recursive: true, force: true })
})

async function seedNotesDomain(trx: any, workspaceId: string, notesDir?: string): Promise<{ planNoteId: string, syncedFolderId: string }> {
  await ensureNotesGraphCatalog(trx)

  const syncedFolder = await trx
    .insertInto('synced_folders')
    .values({
      workspace_id: workspaceId,
      path: notesDir || '/__default_synced_folder__',
    })
    .returning('id')
    .executeTakeFirstOrThrow()

  const folders = ['/project-a', '/project-b', '/project-a/engineering']
  for (const p of folders) {
    await trx
      .insertInto('folders')
      .values({
        workspace_id: workspaceId,
        synced_folder_id: syncedFolder.id,
        path: p,
        cover_content: p === '/project-a' ? 'Project A cover' : null,
        cover_hash: p === '/project-a' ? 'abc123' : null,
      })
      .onConflict(oc => oc.columns(['synced_folder_id', 'path']).doNothing())
      .execute()
  }

  const folderA = await trx
    .selectFrom('folders')
    .select('id')
    .where('synced_folder_id', '=', syncedFolder.id)
    .where('path', '=', '/project-a')
    .executeTakeFirstOrThrow()
  const folderB = await trx
    .selectFrom('folders')
    .select('id')
    .where('synced_folder_id', '=', syncedFolder.id)
    .where('path', '=', '/project-b')
    .executeTakeFirstOrThrow()
  const folderEng = await trx
    .selectFrom('folders')
    .select('id')
    .where('synced_folder_id', '=', syncedFolder.id)
    .where('path', '=', '/project-a/engineering')
    .executeTakeFirstOrThrow()

  const notes = [
    { path: '/project-a/plan.md', title: 'Plan', content: '# Plan\n\nStart here.', status: 'ingested', folder_id: folderA.id },
    { path: '/project-b/ideas.md', title: 'Ideas', content: '# Ideas\n\n[youtube](https://www.youtube.com/watch?v=dQw4w9WgXcQ)', status: 'pending', folder_id: folderB.id },
    { path: '/project-a/engineering/spec.md', title: 'Spec', content: '# Spec\n\nSee [[plan]].', status: 'ingested', folder_id: folderEng.id },
  ]

  for (const n of notes) {
    await trx
      .insertInto('notes')
      .values({
        workspace_id: workspaceId,
        synced_folder_id: syncedFolder.id,
        folder_id: n.folder_id,
        path: n.path,
        title: n.title,
        content: n.content,
        content_hash: 'hash',
        status: n.status as any,
      })
      .execute()
  }

  const tag = await trx
    .insertInto('tags')
    .values({ workspace_id: workspaceId, name: 'Important', name_normalized: 'important' })
    .returning(['id', 'name'])
    .executeTakeFirstOrThrow()

  const planNote = await trx
    .selectFrom('notes')
    .select('id')
    .where('synced_folder_id', '=', syncedFolder.id)
    .where('path', '=', '/project-a/plan.md')
    .executeTakeFirstOrThrow()

  await trx
    .insertInto('note_tags')
    .values({ workspace_id: workspaceId, note_id: planNote.id, tag_id: tag.id, origin: 'ai' })
    .execute()

  const ideasNote = await trx
    .selectFrom('notes')
    .select('id')
    .where('synced_folder_id', '=', syncedFolder.id)
    .where('path', '=', '/project-b/ideas.md')
    .executeTakeFirstOrThrow()

  await trx
    .insertInto('sources')
    .values({
      workspace_id: workspaceId,
      note_id: ideasNote.id,
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      url_normalized: 'youtube.com/watch?v=dQw4w9WgXcQ',
      type: 'youtube',
    })
    .execute()

  return { planNoteId: planNote.id, syncedFolderId: syncedFolder.id }
}

async function taggedEdgeExists(trx: any, noteId: string, tagId: string): Promise<boolean> {
  const rows = await queryCypher<{ r: unknown }>(
    trx,
    `MATCH (n:Note {id: ${agLiteral(noteId)}})-[r:TAGGED]->(t:Tag {id: ${agLiteral(tagId)}}) RETURN r`,
    'r ag_catalog.agtype',
  )
  return rows.length > 0
}

function makeLastRun(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pipeline: 'markdown-note-with-links',
    status: 'failed',
    failed_stage: 'extract-graph',
    error: { name: 'Error', message: 'LLM extraction failed' },
    attempt: 2,
    job_id: 'job-abc',
    started_at: '2026-07-29T10:00:00.000Z',
    finished_at: '2026-07-29T10:00:05.123Z',
    duration_ms: 5123,
    chunks: 4,
    extraction: {
      strategy: 'top-k',
      model: 'openai/gpt-4o-mini',
      messages: [{ role: 'system', content: 'extract' }, { role: 'user', content: 'note body' }],
      response: '{"concepts":[]}',
      usage: { prompt_tokens: 100, completion_tokens: 50 },
      counts: { concepts: 3, relations: 2, mentions: 5, tags: 1 },
    },
    ...overrides,
  }
}

async function setNoteLastRun(trx: any, workspaceId: string, notePath: string, lastRun: unknown): Promise<void> {
  await trx
    .updateTable('notes')
    .set({ last_run: JSON.stringify(lastRun) as any })
    .where('workspace_id', '=', workspaceId)
    .where('path', '=', notePath)
    .execute()
}

describe.sequential('notes API', () => {
  describe('gET /api/folders', () => {
    test('returns nested folder tree with covers and note counts', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      const { syncedFolderId } = await seedNotesDomain(trx, workspace.id)

      const res = await server('/api/folders', { headers: { cookie: cookies } })
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body).toEqual([
        {
          syncedFolderId,
          name: '__default_synced_folder__',
          pathPrefix: null,
          absolutePath: '/__default_synced_folder__',
          hasCover: false,
          noteCount: 0,
          children: [
            {
              name: 'project-a',
              path: '/project-a',
              hasCover: true,
              noteCount: 1,
              children: [
                {
                  name: 'engineering',
                  path: '/project-a/engineering',
                  hasCover: false,
                  noteCount: 1,
                  children: [],
                },
              ],
            },
            {
              name: 'project-b',
              path: '/project-b',
              hasCover: false,
              noteCount: 1,
              children: [],
            },
          ],
        },
      ])
    })

    test('returns one root per synced folder with separate subtrees when relative paths collide', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()

      const rootA = await trx
        .insertInto('synced_folders')
        .values({ workspace_id: workspace.id, path: '/tmp/notes-a' })
        .returning('id')
        .executeTakeFirstOrThrow()
      const rootB = await trx
        .insertInto('synced_folders')
        .values({ workspace_id: workspace.id, path: '/tmp/notes-b' })
        .returning('id')
        .executeTakeFirstOrThrow()

      const folderA = await trx
        .insertInto('folders')
        .values({ workspace_id: workspace.id, synced_folder_id: rootA.id, path: '/ideas' })
        .returning('id')
        .executeTakeFirstOrThrow()
      const folderB = await trx
        .insertInto('folders')
        .values({ workspace_id: workspace.id, synced_folder_id: rootB.id, path: '/ideas' })
        .returning('id')
        .executeTakeFirstOrThrow()

      await trx
        .insertInto('notes')
        .values([
          {
            workspace_id: workspace.id,
            synced_folder_id: rootA.id,
            folder_id: folderA.id,
            path: '/ideas/a.md',
            title: 'A',
            content_hash: 'h1',
            status: 'ingested',
          },
          {
            workspace_id: workspace.id,
            synced_folder_id: rootB.id,
            folder_id: folderB.id,
            path: '/ideas/b.md',
            title: 'B',
            content_hash: 'h2',
            status: 'ingested',
          },
          {
            workspace_id: workspace.id,
            synced_folder_id: rootA.id,
            folder_id: null,
            path: '/root-a-only.md',
            title: 'Root A only',
            content_hash: 'h3',
            status: 'ingested',
          },
        ])
        .execute()

      const res = await server('/api/folders', { headers: { cookie: cookies } })
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body).toHaveLength(2)

      const byId = new Map(body.map((g: any) => [g.syncedFolderId, g]))
      const groupA = byId.get(rootA.id)
      const groupB = byId.get(rootB.id)

      expect(groupA).toBeTruthy()
      expect(groupB).toBeTruthy()
      expect(groupA.name).toBe('notes-a')
      expect(groupB.name).toBe('notes-b')
      expect(groupA.noteCount).toBe(1) // root-a-only.md
      expect(groupB.noteCount).toBe(0)
      expect(groupA.children).toHaveLength(1)
      expect(groupA.children[0]).toMatchObject({ name: 'ideas', path: '/ideas', noteCount: 1 })
      expect(groupB.children).toHaveLength(1)
      expect(groupB.children[0]).toMatchObject({ name: 'ideas', path: '/ideas', noteCount: 1 })
    })

    test('does not emit an empty-name root node: the synced folder root replaces the / row', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      const root = await trx
        .insertInto('synced_folders')
        .values({ workspace_id: workspace.id, path: '/tmp/root' })
        .returning('id')
        .executeTakeFirstOrThrow()

      // Simulate a root cover creating the / row.
      await trx
        .insertInto('folders')
        .values({ workspace_id: workspace.id, synced_folder_id: root.id, path: '/', cover_content: 'root cover', cover_hash: 'h' })
        .execute()

      const res = await server('/api/folders', { headers: { cookie: cookies } })
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body).toHaveLength(1)
      expect(body[0].name).toBe('root')
      expect(body[0].hasCover).toBe(true)
      expect(body[0].children).toEqual([])

      // No empty-name node appears anywhere in the response.
      const hasEmptyName = JSON.stringify(body).includes('"name":""')
      expect(hasEmptyName).toBe(false)
    })

    test('returns pathPrefix for collided roots and basename as name', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      const rootA = await trx
        .insertInto('synced_folders')
        .values({ workspace_id: workspace.id, path: '/tmp/justjom/plans' })
        .returning('id')
        .executeTakeFirstOrThrow()
      const rootB = await trx
        .insertInto('synced_folders')
        .values({ workspace_id: workspace.id, path: '/tmp/cntctus/plans' })
        .returning('id')
        .executeTakeFirstOrThrow()

      const res = await server('/api/folders', { headers: { cookie: cookies } })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveLength(2)

      const byId = new Map(body.map((g: any) => [g.syncedFolderId, g]))
      expect(byId.get(rootA.id)).toMatchObject({ name: 'plans', pathPrefix: 'justjom/' })
      expect(byId.get(rootB.id)).toMatchObject({ name: 'plans', pathPrefix: 'cntctus/' })
    })

    test('returns null pathPrefix when no basenames collide', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      await trx
        .insertInto('synced_folders')
        .values({ workspace_id: workspace.id, path: '/tmp/justjom/plans' })
        .returning('id')
        .executeTakeFirstOrThrow()
      await trx
        .insertInto('synced_folders')
        .values({ workspace_id: workspace.id, path: '/tmp/cntctus/ideas' })
        .returning('id')
        .executeTakeFirstOrThrow()

      const res = await server('/api/folders', { headers: { cookie: cookies } })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveLength(2)
      expect(body.every((g: any) => g.pathPrefix === null)).toBe(true)
    })

    test('uses alias as name and nulls pathPrefix when a collided root has an alias', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      const rootA = await trx
        .insertInto('synced_folders')
        .values({ workspace_id: workspace.id, path: '/tmp/justjom/plans', alias: 'Work Plans' })
        .returning('id')
        .executeTakeFirstOrThrow()
      const rootB = await trx
        .insertInto('synced_folders')
        .values({ workspace_id: workspace.id, path: '/tmp/cntctus/plans' })
        .returning('id')
        .executeTakeFirstOrThrow()

      const res = await server('/api/folders', { headers: { cookie: cookies } })
      expect(res.status).toBe(200)
      const body = await res.json()
      const byId = new Map(body.map((g: any) => [g.syncedFolderId, g]))
      expect(byId.get(rootA.id)).toMatchObject({ name: 'Work Plans', pathPrefix: null })
      // the remaining unaliased root has no collision partner anymore
      expect(byId.get(rootB.id)).toMatchObject({ name: 'plans', pathPrefix: null })
    })
  })

  describe('gET /api/notes?folder=<path>', () => {
    test('returns notes in the selected folder with tags and status', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      await seedNotesDomain(trx, workspace.id)

      const res = await server('/api/notes?folder=/project-a', { headers: { cookie: cookies } })
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body).toHaveLength(1)
      expect(body[0]).toMatchObject({
        path: '/project-a/plan.md',
        title: 'Plan',
        status: 'ingested',
      })
      expect(body[0].tags).toHaveLength(1)
      expect(body[0].tags[0]).toMatchObject({ name: 'Important', origin: 'ai' })
      expect(typeof body[0].updatedAt).toBe('string')
      expect(body[0].lastRun).toBeNull()
    })

    test('returns root-level notes when folder is omitted', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      await seedNotesDomain(trx, workspace.id)

      await trx
        .insertInto('notes')
        .values({
          workspace_id: workspace.id,
          folder_id: null,
          path: '/inbox.md',
          title: 'Inbox',
          content: 'inbox',
          content_hash: 'h',
          status: 'pending',
        })
        .execute()

      const res = await server('/api/notes', { headers: { cookie: cookies } })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveLength(1)
      expect(body[0].path).toBe('/inbox.md')
    })

    test('scopes the notes list to the selected synced folder when relative paths collide', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()

      const rootA = await trx
        .insertInto('synced_folders')
        .values({ workspace_id: workspace.id, path: '/tmp/a' })
        .returning('id')
        .executeTakeFirstOrThrow()
      const rootB = await trx
        .insertInto('synced_folders')
        .values({ workspace_id: workspace.id, path: '/tmp/b' })
        .returning('id')
        .executeTakeFirstOrThrow()

      const folderA = await trx
        .insertInto('folders')
        .values({ workspace_id: workspace.id, synced_folder_id: rootA.id, path: '/ideas' })
        .returning('id')
        .executeTakeFirstOrThrow()
      const folderB = await trx
        .insertInto('folders')
        .values({ workspace_id: workspace.id, synced_folder_id: rootB.id, path: '/ideas' })
        .returning('id')
        .executeTakeFirstOrThrow()

      await trx
        .insertInto('notes')
        .values([
          {
            workspace_id: workspace.id,
            synced_folder_id: rootA.id,
            folder_id: folderA.id,
            path: '/ideas/plan.md',
            title: 'Plan A',
            content_hash: 'h1',
            status: 'ingested',
          },
          {
            workspace_id: workspace.id,
            synced_folder_id: rootB.id,
            folder_id: folderB.id,
            path: '/ideas/plan.md',
            title: 'Plan B',
            content_hash: 'h2',
            status: 'ingested',
          },
        ])
        .execute()

      const resA = await server(`/api/notes?syncedFolder=${rootA.id}&folder=/ideas`, { headers: { cookie: cookies } })
      expect(resA.status).toBe(200)
      const bodyA = await resA.json()
      expect(bodyA).toHaveLength(1)
      expect(bodyA[0].title).toBe('Plan A')

      const resB = await server(`/api/notes?syncedFolder=${rootB.id}&folder=/ideas`, { headers: { cookie: cookies } })
      expect(resB.status).toBe(200)
      const bodyB = await resB.json()
      expect(bodyB).toHaveLength(1)
      expect(bodyB[0].title).toBe('Plan B')
    })

    test('last_run summary strips messages and response', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      await seedNotesDomain(trx, workspace.id)
      await setNoteLastRun(trx, workspace.id, '/project-a/plan.md', makeLastRun())

      const res = await server('/api/notes?folder=/project-a', { headers: { cookie: cookies } })
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body).toHaveLength(1)
      const lastRun = body[0].lastRun
      expect(lastRun).not.toBeNull()
      expect(lastRun.status).toBe('failed')
      expect(lastRun.pipeline).toBe('markdown-note-with-links')
      expect(lastRun.failed_stage).toBe('extract-graph')
      expect(lastRun.error).toEqual({ name: 'Error', message: 'LLM extraction failed' })
      expect(lastRun.duration_ms).toBe(5123)
      expect(lastRun.extraction).toMatchObject({
        strategy: 'top-k',
        model: 'openai/gpt-4o-mini',
        usage: { prompt_tokens: 100, completion_tokens: 50 },
        counts: { concepts: 3, relations: 2, mentions: 5, tags: 1 },
      })
      expect(lastRun.extraction.messages).toBeUndefined()
      expect(lastRun.extraction.response).toBeUndefined()
    })

    test('malformed last_run is serialized as null', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      await seedNotesDomain(trx, workspace.id)
      await setNoteLastRun(trx, workspace.id, '/project-a/plan.md', { garbage: true })

      const res = await server('/api/notes?folder=/project-a', { headers: { cookie: cookies } })
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body[0].lastRun).toBeNull()
    })
  })

  describe('gET /api/notes/:path', () => {
    test('returns note detail with raw content, status, tags, sources and folder', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      await seedNotesDomain(trx, workspace.id)

      const res = await server('/api/notes/project-b/ideas.md', { headers: { cookie: cookies } })
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body).toMatchObject({
        path: '/project-b/ideas.md',
        title: 'Ideas',
        content: '# Ideas\n\n[youtube](https://www.youtube.com/watch?v=dQw4w9WgXcQ)',
        renderMarkdown: true,
        status: 'pending',
        folder: '/project-b',
      })
      expect(body.tags).toHaveLength(0)
      expect(body.sources).toHaveLength(1)
      expect(body.sources[0]).toMatchObject({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', type: 'youtube' })
      expect(body.lastRun).toBeNull()
    })

    test('detail endpoint returns full last_run with messages and response verbatim', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      await seedNotesDomain(trx, workspace.id)
      await setNoteLastRun(trx, workspace.id, '/project-a/plan.md', makeLastRun())

      const res = await server('/api/notes/project-a/plan.md', { headers: { cookie: cookies } })
      expect(res.status).toBe(200)

      const body = await res.json()
      const lastRun = body.lastRun
      expect(lastRun).not.toBeNull()
      expect(lastRun.extraction.messages).toEqual([
        { role: 'system', content: 'extract' },
        { role: 'user', content: 'note body' },
      ])
      expect(lastRun.extraction.response).toBe('{"concepts":[]}')
    })

    test('malformed last_run on detail endpoint returns null without 500', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      await seedNotesDomain(trx, workspace.id)
      await setNoteLastRun(trx, workspace.id, '/project-a/plan.md', { garbage: true })

      const res = await server('/api/notes/project-a/plan.md', { headers: { cookie: cookies } })
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.lastRun).toBeNull()
    })

    test('rejects path traversal attempts', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      await seedNotesDomain(trx, workspace.id)

      const res = await server('/api/notes/project-a/../plan.md', { headers: { cookie: cookies } })
      expect(res.status).toBe(404)
    })

    test('returns 404 for unknown note paths', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      await seedNotesDomain(trx, workspace.id)

      const res = await server('/api/notes/unknown.md', { headers: { cookie: cookies } })
      expect(res.status).toBe(404)
    })
  })

  describe('pUT /api/notes/:path', () => {
    test('writes raw markdown to the notes dir and returns the pre-ingestion row', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      const notesDir = givenNotesDir()
      await seedNotesDomain(trx, workspace.id, notesDir)

      // Seed the file on disk so the PUT can update it.
      const abs = path.join(notesDir, 'project-a/plan.md')
      mkdirSync(path.dirname(abs), { recursive: true })
      writeFileSync(abs, '# Plan\n\nStart here.')

      const res = await server('/api/notes/project-a/plan.md', {
        method: 'PUT',
        headers: { 'cookie': cookies, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '# Plan\n\nUpdated content.' }),
      })
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.path).toBe('/project-a/plan.md')
      expect(body.content).toBe('# Plan\n\nUpdated content.')

      const onDisk = readFileSync(abs, 'utf8')
      expect(onDisk).toBe('# Plan\n\nUpdated content.')
    })

    test('creates a new note when the file does not exist yet', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      const notesDir = givenNotesDir()
      await seedNotesDomain(trx, workspace.id, notesDir)

      const res = await server('/api/notes/project-a/brand-new.md', {
        method: 'PUT',
        headers: { 'cookie': cookies, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '# Brand new\n' }),
      })
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.path).toBe('/project-a/brand-new.md')
      expect(body.status).toBe('pending')

      const onDisk = readFileSync(path.join(notesDir, 'project-a/brand-new.md'), 'utf8')
      expect(onDisk).toBe('# Brand new\n')

      const row = await trx
        .selectFrom('notes')
        .select('status')
        .where('workspace_id', '=', workspace.id)
        .where('path', '=', '/project-a/brand-new.md')
        .executeTakeFirstOrThrow()
      expect(row.status).toBe('pending')
    })

    test('rejects traversal attempts when writing', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      const notesDir = givenNotesDir()
      await seedNotesDomain(trx, workspace.id, notesDir)

      // Encoded dot segments must never resolve to a writable path —
      // rejected either by the router (404) or the path guard (400)
      const res = await server('/api/notes/%2E%2E/%2E%2E/evil.md', {
        method: 'PUT',
        headers: { 'cookie': cookies, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'x' }),
      })
      expect([400, 404]).toContain(res.status)
      expect(existsSync(path.join(notesDir, '..', '..', 'evil.md'))).toBe(false)
    })
  })

  describe('pOST /api/notes/:path/tags', () => {
    test('adds a user tag, removes any existing dismissal, and mirrors to AGE', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      await seedNotesDomain(trx, workspace.id)

      const planNote = await trx
        .selectFrom('notes')
        .select('id')
        .where('workspace_id', '=', workspace.id)
        .where('path', '=', '/project-a/plan.md')
        .executeTakeFirstOrThrow()

      const tag = await trx
        .insertInto('tags')
        .values({ workspace_id: workspace.id, name: 'Review', name_normalized: 'review' })
        .returning('id')
        .executeTakeFirstOrThrow()

      await trx
        .insertInto('note_tag_dismissals')
        .values({ workspace_id: workspace.id, note_id: planNote.id, tag_id: tag.id })
        .execute()

      const res = await server('/api/notes/project-a/plan.md/tags', {
        method: 'POST',
        headers: { 'cookie': cookies, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Review' }),
      })
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.name).toBe('Review')
      expect(body.origin).toBe('user')

      const link = await trx
        .selectFrom('note_tags')
        .select('origin')
        .where('note_id', '=', planNote.id)
        .where('tag_id', '=', tag.id)
        .executeTakeFirstOrThrow()
      expect(link.origin).toBe('user')

      const dismissal = await trx
        .selectFrom('note_tag_dismissals')
        .selectAll()
        .where('note_id', '=', planNote.id)
        .where('tag_id', '=', tag.id)
        .execute()
      expect(dismissal).toHaveLength(0)

      expect(await taggedEdgeExists(trx, planNote.id, tag.id)).toBe(true)
    })
  })

  describe('dELETE /api/notes/:path/tags/:tagId', () => {
    test('removes an AI tag and records a dismissal, removing the AGE edge', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      await seedNotesDomain(trx, workspace.id)

      const planNote = await trx
        .selectFrom('notes')
        .select('id')
        .where('workspace_id', '=', workspace.id)
        .where('path', '=', '/project-a/plan.md')
        .executeTakeFirstOrThrow()

      const tag = await trx
        .selectFrom('tags')
        .select('id')
        .where('workspace_id', '=', workspace.id)
        .where('name', '=', 'Important')
        .executeTakeFirstOrThrow()

      // Mirror the endpoints and edge into AGE so we can assert it is deleted.
      await mergeNoteNode(trx, { id: planNote.id, workspaceId: workspace.id })
      await mergeTagNode(trx, { id: tag.id, workspaceId: workspace.id, name: 'Important' })
      await mergeTaggedEdge(trx, { noteId: planNote.id, tagId: tag.id, workspaceId: workspace.id })
      expect(await taggedEdgeExists(trx, planNote.id, tag.id)).toBe(true)

      const res = await server(`/api/notes/project-a/plan.md/tags/${tag.id}`, {
        method: 'DELETE',
        headers: { cookie: cookies },
      })
      expect(res.status).toBe(200)

      const link = await trx
        .selectFrom('note_tags')
        .selectAll()
        .where('note_id', '=', planNote.id)
        .where('tag_id', '=', tag.id)
        .execute()
      expect(link).toHaveLength(0)

      const dismissal = await trx
        .selectFrom('note_tag_dismissals')
        .selectAll()
        .where('note_id', '=', planNote.id)
        .where('tag_id', '=', tag.id)
        .executeTakeFirstOrThrow()
      expect(dismissal).toBeTruthy()

      expect(await taggedEdgeExists(trx, planNote.id, tag.id)).toBe(false)
    })

    test('removes a user tag without recording a dismissal', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      await seedNotesDomain(trx, workspace.id)

      const planNote = await trx
        .selectFrom('notes')
        .select('id')
        .where('workspace_id', '=', workspace.id)
        .where('path', '=', '/project-a/plan.md')
        .executeTakeFirstOrThrow()

      const tag = await trx
        .selectFrom('tags')
        .select('id')
        .where('workspace_id', '=', workspace.id)
        .where('name', '=', 'Important')
        .executeTakeFirstOrThrow()

      await trx
        .updateTable('note_tags')
        .set({ origin: 'user' })
        .where('note_id', '=', planNote.id)
        .where('tag_id', '=', tag.id)
        .execute()

      const res = await server(`/api/notes/project-a/plan.md/tags/${tag.id}`, {
        method: 'DELETE',
        headers: { cookie: cookies },
      })
      expect(res.status).toBe(200)

      const dismissal = await trx
        .selectFrom('note_tag_dismissals')
        .selectAll()
        .where('note_id', '=', planNote.id)
        .where('tag_id', '=', tag.id)
        .execute()
      expect(dismissal).toHaveLength(0)
    })
  })
})
