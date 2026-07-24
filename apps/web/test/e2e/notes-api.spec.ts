import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  process.env.NUXT_NOTES_DIR = dir
  return dir
}

afterAll(() => {
  for (const dir of tempDirs)
    rmSync(dir, { recursive: true, force: true })
})

async function seedNotesDomain(trx: any, workspaceId: string): Promise<void> {
  await ensureNotesGraphCatalog(trx)

  const folders = ['/project-a', '/project-b', '/project-a/engineering']
  for (const p of folders) {
    await trx
      .insertInto('folders')
      .values({
        workspace_id: workspaceId,
        path: p,
        cover_content: p === '/project-a' ? 'Project A cover' : null,
        cover_hash: p === '/project-a' ? 'abc123' : null,
      })
      .onConflict(oc => oc.columns(['workspace_id', 'path']).doNothing())
      .execute()
  }

  const folderA = await trx
    .selectFrom('folders')
    .select('id')
    .where('workspace_id', '=', workspaceId)
    .where('path', '=', '/project-a')
    .executeTakeFirstOrThrow()
  const folderB = await trx
    .selectFrom('folders')
    .select('id')
    .where('workspace_id', '=', workspaceId)
    .where('path', '=', '/project-b')
    .executeTakeFirstOrThrow()
  const folderEng = await trx
    .selectFrom('folders')
    .select('id')
    .where('workspace_id', '=', workspaceId)
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
    .where('workspace_id', '=', workspaceId)
    .where('path', '=', '/project-a/plan.md')
    .executeTakeFirstOrThrow()

  await trx
    .insertInto('note_tags')
    .values({ workspace_id: workspaceId, note_id: planNote.id, tag_id: tag.id, origin: 'ai' })
    .execute()

  const ideasNote = await trx
    .selectFrom('notes')
    .select('id')
    .where('workspace_id', '=', workspaceId)
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
}

async function taggedEdgeExists(trx: any, noteId: string, tagId: string): Promise<boolean> {
  const rows = await queryCypher<{ r: unknown }>(
    trx,
    `MATCH (n:Note {id: ${agLiteral(noteId)}})-[r:TAGGED]->(t:Tag {id: ${agLiteral(tagId)}}) RETURN r`,
    'r ag_catalog.agtype',
  )
  return rows.length > 0
}

describe.sequential('notes API', () => {
  describe('gET /api/folders', () => {
    test('returns nested folder tree with covers and note counts', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      givenNotesDir()
      await seedNotesDomain(trx, workspace.id)

      const res = await server('/api/folders', { headers: { cookie: cookies } })
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body).toEqual([
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
      ])
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
      await seedNotesDomain(trx, workspace.id)
      const notesDir = givenNotesDir()

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

    test('rejects traversal attempts when writing', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      await seedNotesDomain(trx, workspace.id)
      givenNotesDir()

      const res = await server('/api/notes/project-a/../plan.md', {
        method: 'PUT',
        headers: { 'cookie': cookies, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'x' }),
      })
      expect(res.status).toBe(404)
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
