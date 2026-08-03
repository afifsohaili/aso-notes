import { givenVerifiedUser } from '@base/testing/auth'
import { test } from '@base/testing/test'
import { describe, expect } from 'vitest'
import {
  mergeConceptNode,
  mergeGroupedUnderEdge,
  mergeMentionsEdge,
  mergeNoteNode,
  mergeRelatesToEdge,
  mergeTaggedEdge,
  mergeTagNode,
  mergeTopicNode,
} from '../../server/lib/graph/helpers'
import { ensureNotesGraphCatalog } from './age-catalog'

/**
 * Small ego-graph fixture:
 *
 *   Pivot -RELATES_TO-> Query -RELATES_TO-> Retrieval -RELATES_TO-> Summary
 *   note -MENTIONS-> Pivot
 *   note -TAGGED-> tag
 *   Pivot -GROUPED_UNDER-> topic
 *
 * From Pivot: Query is 1 hop, Retrieval is 2 hops, Summary is 3 hops.
 */
async function seedNeighborhoodGraph(trx: any, workspaceId: string) {
  await ensureNotesGraphCatalog(trx)

  const note = await trx
    .insertInto('notes')
    .values({
      workspace_id: workspaceId,
      path: '/project/main.md',
      title: 'Main Note',
      content: '# Main',
      content_hash: 'hash-main',
      status: 'ingested',
    })
    .returning(['id'])
    .executeTakeFirstOrThrow()

  const chunk = await trx
    .insertInto('chunks')
    .values({ workspace_id: workspaceId, note_id: note.id, seq: 0, text: 'x' })
    .returning(['id'])
    .executeTakeFirstOrThrow()

  const makeConcept = async (name: string) => {
    const row = await trx
      .insertInto('concepts')
      .values({ workspace_id: workspaceId, name, name_normalized: name.toLowerCase(), description: '' })
      .returning(['id'])
      .executeTakeFirstOrThrow()
    await mergeConceptNode(trx, { id: row.id, workspaceId, name })
    return row
  }

  const pivot = await makeConcept('Pivot')
  const query = await makeConcept('Query')
  const retrieval = await makeConcept('Retrieval')
  const summary = await makeConcept('Summary')

  const tag = await trx
    .insertInto('tags')
    .values({ workspace_id: workspaceId, name: 'AI', name_normalized: 'ai' })
    .returning(['id', 'name'])
    .executeTakeFirstOrThrow()

  const topic = await trx
    .insertInto('topics')
    .values({ workspace_id: workspaceId, name: 'Databases', name_normalized: 'databases', description: '' })
    .returning(['id', 'name'])
    .executeTakeFirstOrThrow()

  await mergeNoteNode(trx, { id: note.id, workspaceId })
  await mergeTagNode(trx, { id: tag.id, workspaceId, name: tag.name })
  await mergeTopicNode(trx, { id: topic.id, workspaceId, name: topic.name })

  await mergeRelatesToEdge(trx, { fromId: pivot.id, toId: query.id, type: 'related-to', workspaceId })
  await mergeRelatesToEdge(trx, { fromId: query.id, toId: retrieval.id, type: 'related-to', workspaceId })
  await mergeRelatesToEdge(trx, { fromId: retrieval.id, toId: summary.id, type: 'related-to', workspaceId })
  await mergeMentionsEdge(trx, { noteId: note.id, conceptId: pivot.id, workspaceId })
  await mergeTaggedEdge(trx, { noteId: note.id, tagId: tag.id, workspaceId })
  await mergeGroupedUnderEdge(trx, { conceptId: pivot.id, topicId: topic.id, workspaceId })

  await trx
    .insertInto('mentions')
    .values({ workspace_id: workspaceId, chunk_id: chunk.id, concept_id: pivot.id })
    .execute()
  await trx
    .insertInto('concept_topics')
    .values({ workspace_id: workspaceId, concept_id: pivot.id, topic_id: topic.id })
    .execute()

  return { pivot, query, retrieval, summary, note, tag, topic }
}

describe('graph neighborhood API', () => {
  describe('gET /api/graph/neighborhood', () => {
    test('returns 401 when unauthenticated', async ({ server }) => {
      const res = await server('/api/graph/neighborhood?node=any')
      expect(res.status).toBe(401)
    })

    test('returns 400 when node param is missing', async ({ server }) => {
      const { cookies } = await givenVerifiedUser()
      const res = await server('/api/graph/neighborhood', { headers: { cookie: cookies } })
      expect(res.status).toBe(400)
    })

    test('returns the ego graph at depth 1 (default)', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      const seeded = await seedNeighborhoodGraph(trx, workspace.id)

      const res = await server(`/api/graph/neighborhood?node=${seeded.pivot.id}`, { headers: { cookie: cookies } })
      expect(res.status).toBe(200)
      const body = await res.json()

      const nodeIds = new Set(body.nodes.map((n: any) => n.id))
      expect(nodeIds.has(seeded.pivot.id)).toBe(true)
      expect(nodeIds.has(seeded.query.id)).toBe(true)
      expect(nodeIds.has(seeded.note.id)).toBe(true)
      expect(nodeIds.has(seeded.topic.id)).toBe(true)
      // tag is 2 hops away (Pivot <-MENTIONS- note -TAGGED-> tag)
      expect(nodeIds.has(seeded.tag.id)).toBe(false)
      expect(nodeIds.has(seeded.retrieval.id)).toBe(false)
      expect(body.nodes).toHaveLength(4)

      const pivotNode = body.nodes.find((n: any) => n.id === seeded.pivot.id)
      expect(pivotNode).toMatchObject({ label: 'Concept', name: 'Pivot', ref: seeded.pivot.id })
      const noteNode = body.nodes.find((n: any) => n.id === seeded.note.id)
      expect(noteNode).toMatchObject({ label: 'Note', name: 'Main Note', ref: '/project/main.md' })
      const topicNode = body.nodes.find((n: any) => n.id === seeded.topic.id)
      expect(topicNode).toMatchObject({ label: 'Topic', name: 'Databases', ref: seeded.topic.id })

      expect(body.edges).toHaveLength(3)
      const relates = body.edges.find(
        (e: any) => e.source === seeded.pivot.id && e.target === seeded.query.id && e.type === 'RELATES_TO',
      )
      expect(relates).toBeTruthy()
      expect(relates.edgeType).toBe('related-to')
      expect(body.edges.find((e: any) => e.source === seeded.note.id && e.target === seeded.pivot.id && e.type === 'MENTIONS')).toBeTruthy()
      expect(body.edges.find((e: any) => e.source === seeded.pivot.id && e.target === seeded.topic.id && e.type === 'GROUPED_UNDER')).toBeTruthy()
    })

    test('reaches 2 hops at depth 2 but not 3', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      const seeded = await seedNeighborhoodGraph(trx, workspace.id)

      const res = await server(`/api/graph/neighborhood?node=${seeded.pivot.id}&depth=2`, { headers: { cookie: cookies } })
      expect(res.status).toBe(200)
      const body = await res.json()

      const nodeIds = new Set(body.nodes.map((n: any) => n.id))
      expect(nodeIds.has(seeded.retrieval.id)).toBe(true)
      expect(nodeIds.has(seeded.tag.id)).toBe(true)
      expect(nodeIds.has(seeded.summary.id)).toBe(false)
      expect(body.nodes).toHaveLength(6)
      expect(body.edges).toHaveLength(5)
      expect(body.edges.find((e: any) => e.source === seeded.query.id && e.target === seeded.retrieval.id && e.type === 'RELATES_TO')).toBeTruthy()
      expect(body.edges.find((e: any) => e.source === seeded.note.id && e.target === seeded.tag.id && e.type === 'TAGGED')).toBeTruthy()
    })

    test('clamps depth 0 up to 1', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      const seeded = await seedNeighborhoodGraph(trx, workspace.id)

      const res = await server(`/api/graph/neighborhood?node=${seeded.pivot.id}&depth=0`, { headers: { cookie: cookies } })
      expect(res.status).toBe(200)
      const body = await res.json()
      const nodeIds = new Set(body.nodes.map((n: any) => n.id))
      expect(nodeIds.has(seeded.query.id)).toBe(true)
      expect(nodeIds.has(seeded.retrieval.id)).toBe(false)
    })

    test('clamps depth 99 down to 2', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      const seeded = await seedNeighborhoodGraph(trx, workspace.id)

      const res = await server(`/api/graph/neighborhood?node=${seeded.pivot.id}&depth=99`, { headers: { cookie: cookies } })
      expect(res.status).toBe(200)
      const body = await res.json()
      const nodeIds = new Set(body.nodes.map((n: any) => n.id))
      expect(nodeIds.has(seeded.retrieval.id)).toBe(true)
      expect(nodeIds.has(seeded.summary.id)).toBe(false)
    })

    test('returns 200 with empty payload for an unknown node', async ({ server, trx }) => {
      const { cookies } = await givenVerifiedUser()
      await ensureNotesGraphCatalog(trx)
      const res = await server(`/api/graph/neighborhood?node=${crypto.randomUUID()}`, { headers: { cookie: cookies } })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ nodes: [], edges: [] })
    })

    test('does not leak other workspaces nodes or edges', async ({ server, trx }) => {
      const { cookies } = await givenVerifiedUser()
      const other = await givenVerifiedUser()
      const seeded = await seedNeighborhoodGraph(trx, other.workspace.id)

      const res = await server(`/api/graph/neighborhood?node=${seeded.pivot.id}`, { headers: { cookie: cookies } })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ nodes: [], edges: [] })
    })

    test('returns empty payload when user has no workspace', async ({ server, trx }) => {
      const { user, cookies } = await givenVerifiedUser()
      await ensureNotesGraphCatalog(trx)
      await trx.deleteFrom('memberships').where('user_id', '=', user.id).execute()

      const res = await server('/api/graph/neighborhood?node=whatever', { headers: { cookie: cookies } })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ nodes: [], edges: [] })
    })
  })
})
