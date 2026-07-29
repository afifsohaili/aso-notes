import { givenVerifiedUser } from '@base/testing/auth'
import { test } from '@base/testing/test'
import { sql } from 'kysely'
import { describe, expect } from 'vitest'
import { queryCypher } from '../../server/lib/graph/age'
import {
  mergeConceptNode,
  mergeGroupedUnderEdge,
  mergeLinkEdge,
  mergeMentionsEdge,
  mergeNoteNode,
  mergeRelatesToEdge,
  mergeTaggedEdge,
  mergeTagNode,
  mergeTopicNode,
} from '../../server/lib/graph/helpers'
import { ensureNotesGraphCatalog } from './age-catalog'

async function seedRebuildDomain(trx: any, workspaceId: string) {
  await ensureNotesGraphCatalog(trx)

  const note = await trx
    .insertInto('notes')
    .values({
      workspace_id: workspaceId,
      path: '/seed.md',
      title: 'Seed Note',
      content: '# Seed\n\nGraph RAG uses Kysely.',
      content_hash: 'hash-seed',
      status: 'ingested',
    })
    .returning(['id', 'path', 'title'])
    .executeTakeFirstOrThrow()

  const concept = await trx
    .insertInto('concepts')
    .values({
      workspace_id: workspaceId,
      name: 'Graph RAG',
      name_normalized: 'graph rag',
      description: 'retrieval over a knowledge graph',
    })
    .returning(['id', 'name'])
    .executeTakeFirstOrThrow()

  const topic = await trx
    .insertInto('topics')
    .values({
      workspace_id: workspaceId,
      name: 'Engineering',
      name_normalized: 'engineering',
      description: 'software engineering',
    })
    .returning(['id', 'name'])
    .executeTakeFirstOrThrow()

  const chunk = await trx
    .insertInto('chunks')
    .values({
      workspace_id: workspaceId,
      note_id: note.id,
      seq: 0,
      text: 'Graph RAG uses Kysely.',
    })
    .returning('id')
    .executeTakeFirstOrThrow()

  await trx
    .insertInto('mentions')
    .values({ workspace_id: workspaceId, chunk_id: chunk.id, concept_id: concept.id })
    .execute()

  await trx
    .insertInto('relations')
    .values({
      workspace_id: workspaceId,
      from_concept_id: concept.id,
      to_concept_id: concept.id,
      type: 'self',
      description: '',
    })
    .execute()

  await trx
    .insertInto('concept_topics')
    .values({ workspace_id: workspaceId, concept_id: concept.id, topic_id: topic.id })
    .execute()

  const tag = await trx
    .insertInto('tags')
    .values({ workspace_id: workspaceId, name: 'ai-tag', name_normalized: 'ai-tag' })
    .returning(['id', 'name'])
    .executeTakeFirstOrThrow()

  await trx
    .insertInto('note_tags')
    .values({ workspace_id: workspaceId, note_id: note.id, tag_id: tag.id, origin: 'ai' })
    .execute()

  const userTag = await trx
    .insertInto('tags')
    .values({ workspace_id: workspaceId, name: 'user-tag', name_normalized: 'user-tag' })
    .returning(['id', 'name'])
    .executeTakeFirstOrThrow()

  await trx
    .insertInto('note_tags')
    .values({ workspace_id: workspaceId, note_id: note.id, tag_id: userTag.id, origin: 'user' })
    .execute()

  await trx
    .insertInto('note_tag_dismissals')
    .values({ workspace_id: workspaceId, note_id: note.id, tag_id: tag.id })
    .execute()

  await trx
    .insertInto('links')
    .values({
      workspace_id: workspaceId,
      from_note_id: note.id,
      to_note_id: note.id,
      raw_target: '/seed.md',
    })
    .execute()

  await trx
    .insertInto('sources')
    .values({
      workspace_id: workspaceId,
      note_id: note.id,
      url: 'https://example.com',
      url_normalized: 'example.com',
    })
    .execute()

  await mergeNoteNode(trx, { id: note.id, workspaceId })
  await mergeConceptNode(trx, { id: concept.id, workspaceId, name: concept.name })
  await mergeTopicNode(trx, { id: topic.id, workspaceId, name: topic.name })
  await mergeTagNode(trx, { id: tag.id, workspaceId, name: tag.name })
  await mergeMentionsEdge(trx, { noteId: note.id, conceptId: concept.id, workspaceId })
  await mergeRelatesToEdge(trx, { fromId: concept.id, toId: concept.id, type: 'self', workspaceId })
  await mergeGroupedUnderEdge(trx, { conceptId: concept.id, topicId: topic.id, workspaceId })
  await mergeTaggedEdge(trx, { noteId: note.id, tagId: tag.id, workspaceId })
  await mergeLinkEdge(trx, { fromNoteId: note.id, toNoteId: note.id, workspaceId })

  return { note, concept, topic, tag, userTag }
}

async function rowCount(trx: any, table: string, where?: (q: any) => any): Promise<number> {
  let q = trx.selectFrom(table).select(sql<number>`count(*)::int`.as('c'))
  if (where)
    q = where(q)
  const row = await q.executeTakeFirstOrThrow()
  return row.c
}

describe('settings rebuild API', () => {
  test('POST /api/settings/rebuild returns 401 when unauthenticated', async ({ server }) => {
    const res = await server('/api/settings/rebuild', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status).toBe(401)
  })

  test('POST /api/settings/rebuild wipes graph-derived rows and resets notes to pending', async ({ server, trx }) => {
    const { workspace, cookies } = await givenVerifiedUser()
    const seeded = await seedRebuildDomain(trx, workspace.id)

    const res = await server('/api/settings/rebuild', {
      method: 'POST',
      headers: { 'cookie': cookies, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.notesReset).toBe(1)
    expect(body.wiped).toEqual({
      mentions: 1,
      relations: 1,
      conceptTopics: 1,
      concepts: 1,
      topics: 1,
      chunks: 1,
      links: 1,
      sources: 1,
      aiNoteTags: 1,
    })

    expect(await rowCount(trx, 'mentions', (q: any) => q.where('workspace_id', '=', workspace.id))).toBe(0)
    expect(await rowCount(trx, 'relations', (q: any) => q.where('workspace_id', '=', workspace.id))).toBe(0)
    expect(await rowCount(trx, 'concept_topics', (q: any) => q.where('workspace_id', '=', workspace.id))).toBe(0)
    expect(await rowCount(trx, 'concepts', (q: any) => q.where('workspace_id', '=', workspace.id))).toBe(0)
    expect(await rowCount(trx, 'topics', (q: any) => q.where('workspace_id', '=', workspace.id))).toBe(0)
    expect(await rowCount(trx, 'chunks', (q: any) => q.where('workspace_id', '=', workspace.id))).toBe(0)
    expect(await rowCount(trx, 'links', (q: any) => q.where('workspace_id', '=', workspace.id))).toBe(0)
    expect(await rowCount(trx, 'sources', (q: any) => q.where('workspace_id', '=', workspace.id))).toBe(0)

    const aiNoteTags = await rowCount(trx, 'note_tags', (q: any) =>
      q.where('workspace_id', '=', workspace.id).where('origin', '=', 'ai'))
    expect(aiNoteTags).toBe(0)

    const userNoteTags = await trx
      .selectFrom('note_tags')
      .innerJoin('tags', 'tags.id', 'note_tags.tag_id')
      .select(['tags.name', 'note_tags.origin'])
      .where('note_tags.workspace_id', '=', workspace.id)
      .execute()
    expect(userNoteTags).toEqual([{ name: 'user-tag', origin: 'user' }])

    const dismissals = await trx
      .selectFrom('note_tag_dismissals')
      .selectAll()
      .where('workspace_id', '=', workspace.id)
      .execute()
    expect(dismissals).toHaveLength(1)
    expect(dismissals[0]!.tag_id).toBe(seeded.tag.id)

    const notes = await trx
      .selectFrom('notes')
      .select(['status', 'ingested_hash'])
      .where('workspace_id', '=', workspace.id)
      .execute()
    expect(notes).toEqual([expect.objectContaining({ status: 'pending' })])

    const graphRows = await queryCypher<{ n: unknown }>(
      trx,
      'MATCH (n) RETURN count(n) AS n',
      'n ag_catalog.agtype',
    )
    expect(Number(graphRows[0]!.n)).toBe(0)
  })

  test('POST /api/settings/rebuild leaves other workspaces untouched', async ({ server, trx }) => {
    const { cookies } = await givenVerifiedUser()
    const other = await givenVerifiedUser()
    await seedRebuildDomain(trx, other.workspace.id)

    const res = await server('/api/settings/rebuild', {
      method: 'POST',
      headers: { 'cookie': cookies, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(200)
    expect((await res.json()).notesReset).toBe(0)

    expect(await rowCount(trx, 'concepts', (q: any) => q.where('workspace_id', '=', other.workspace.id))).toBe(1)
    expect(await rowCount(trx, 'notes', (q: any) => q.where('workspace_id', '=', other.workspace.id).where('status', '=', 'ingested'))).toBe(1)
  })

  test('GET /api/notes/status-counts returns 401 when unauthenticated', async ({ server }) => {
    const res = await server('/api/notes/status-counts')
    expect(res.status).toBe(401)
  })

  test('GET /api/notes/status-counts returns status counts for the workspace', async ({ server, trx }) => {
    const { workspace, cookies } = await givenVerifiedUser()
    await trx
      .insertInto('notes')
      .values([
        { workspace_id: workspace.id, path: '/a.md', title: 'A', content: '', content_hash: 'a', status: 'pending' },
        { workspace_id: workspace.id, path: '/b.md', title: 'B', content: '', content_hash: 'b', status: 'queued' },
        { workspace_id: workspace.id, path: '/c.md', title: 'C', content: '', content_hash: 'c', status: 'processing' },
        { workspace_id: workspace.id, path: '/d.md', title: 'D', content: '', content_hash: 'd', status: 'ingested' },
        { workspace_id: workspace.id, path: '/e.md', title: 'E', content: '', content_hash: 'e', status: 'failed' },
      ])
      .execute()

    const res = await server('/api/notes/status-counts', { headers: { cookie: cookies } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ pending: 1, queued: 1, processing: 1, ingested: 1, failed: 1 })
  })
})
