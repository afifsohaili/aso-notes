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

async function seedGraphDomain(trx: any, workspaceId: string) {
  await ensureNotesGraphCatalog(trx)

  const conceptA = await trx
    .insertInto('concepts')
    .values({
      workspace_id: workspaceId,
      name: 'Graph RAG',
      name_normalized: 'graph rag',
      description: 'retrieval over a knowledge graph',
    })
    .returning(['id', 'name'])
    .executeTakeFirstOrThrow()

  const conceptB = await trx
    .insertInto('concepts')
    .values({
      workspace_id: workspaceId,
      name: 'Kysely',
      name_normalized: 'kysely',
      description: 'type-safe SQL builder',
    })
    .returning(['id', 'name'])
    .executeTakeFirstOrThrow()

  const conceptC = await trx
    .insertInto('concepts')
    .values({
      workspace_id: workspaceId,
      name: 'Embeddings',
      name_normalized: 'embeddings',
      description: 'vector representations',
    })
    .returning(['id', 'name'])
    .executeTakeFirstOrThrow()

  const note = await trx
    .insertInto('notes')
    .values({
      workspace_id: workspaceId,
      path: '/project/main.md',
      title: 'Main Note',
      content: '# Main\n\nGraph RAG uses Kysely.',
      content_hash: 'hash-main',
      status: 'ingested',
    })
    .returning(['id', 'path', 'title'])
    .executeTakeFirstOrThrow()

  const chunk1 = await trx
    .insertInto('chunks')
    .values({
      workspace_id: workspaceId,
      note_id: note.id,
      seq: 0,
      text: 'Graph RAG uses Kysely.',
    })
    .returning('id')
    .executeTakeFirstOrThrow()

  const chunk2 = await trx
    .insertInto('chunks')
    .values({
      workspace_id: workspaceId,
      note_id: note.id,
      seq: 1,
      text: 'Kysely is great.',
    })
    .returning('id')
    .executeTakeFirstOrThrow()

  await trx
    .insertInto('mentions')
    .values({ workspace_id: workspaceId, chunk_id: chunk1.id, concept_id: conceptA.id })
    .execute()

  await trx
    .insertInto('mentions')
    .values({ workspace_id: workspaceId, chunk_id: chunk1.id, concept_id: conceptB.id })
    .execute()

  await trx
    .insertInto('mentions')
    .values({ workspace_id: workspaceId, chunk_id: chunk2.id, concept_id: conceptB.id })
    .execute()

  await trx
    .insertInto('relations')
    .values({
      workspace_id: workspaceId,
      from_concept_id: conceptA.id,
      to_concept_id: conceptB.id,
      type: 'implemented-with',
      description: '',
    })
    .execute()

  await trx
    .insertInto('relations')
    .values({
      workspace_id: workspaceId,
      from_concept_id: conceptC.id,
      to_concept_id: conceptA.id,
      type: 'depends-on',
      description: '',
    })
    .execute()

  const tag = await trx
    .insertInto('tags')
    .values({ workspace_id: workspaceId, name: 'AI', name_normalized: 'ai' })
    .returning(['id', 'name'])
    .executeTakeFirstOrThrow()

  await trx
    .insertInto('note_tags')
    .values({ workspace_id: workspaceId, note_id: note.id, tag_id: tag.id, origin: 'ai' })
    .execute()

  await mergeConceptNode(trx, { id: conceptA.id, workspaceId, name: conceptA.name })
  await mergeConceptNode(trx, { id: conceptB.id, workspaceId, name: conceptB.name })
  await mergeConceptNode(trx, { id: conceptC.id, workspaceId, name: conceptC.name })
  await mergeNoteNode(trx, { id: note.id, workspaceId })
  await mergeTagNode(trx, { id: tag.id, workspaceId, name: tag.name })
  await mergeRelatesToEdge(trx, { fromId: conceptA.id, toId: conceptB.id, type: 'implemented-with', workspaceId })
  await mergeRelatesToEdge(trx, { fromId: conceptC.id, toId: conceptA.id, type: 'depends-on', workspaceId })
  await mergeMentionsEdge(trx, { noteId: note.id, conceptId: conceptA.id, workspaceId })
  await mergeMentionsEdge(trx, { noteId: note.id, conceptId: conceptB.id, workspaceId })
  await mergeTaggedEdge(trx, { noteId: note.id, tagId: tag.id, workspaceId })

  const topicAi = await trx
    .insertInto('topics')
    .values({ workspace_id: workspaceId, name: 'AI Engineering', name_normalized: 'ai engineering', description: 'AI-related engineering topics' })
    .returning(['id', 'name'])
    .executeTakeFirstOrThrow()

  const topicDb = await trx
    .insertInto('topics')
    .values({ workspace_id: workspaceId, name: 'Databases', name_normalized: 'databases', description: 'Database systems' })
    .returning(['id', 'name'])
    .executeTakeFirstOrThrow()

  await trx
    .insertInto('concept_topics')
    .values([
      { workspace_id: workspaceId, concept_id: conceptA.id, topic_id: topicAi.id },
      { workspace_id: workspaceId, concept_id: conceptA.id, topic_id: topicDb.id },
      { workspace_id: workspaceId, concept_id: conceptB.id, topic_id: topicDb.id },
      { workspace_id: workspaceId, concept_id: conceptC.id, topic_id: topicAi.id },
    ])
    .execute()

  await mergeTopicNode(trx, { id: topicAi.id, workspaceId, name: topicAi.name })
  await mergeTopicNode(trx, { id: topicDb.id, workspaceId, name: topicDb.name })
  await mergeGroupedUnderEdge(trx, { conceptId: conceptA.id, topicId: topicAi.id, workspaceId })
  await mergeGroupedUnderEdge(trx, { conceptId: conceptA.id, topicId: topicDb.id, workspaceId })
  await mergeGroupedUnderEdge(trx, { conceptId: conceptB.id, topicId: topicDb.id, workspaceId })
  await mergeGroupedUnderEdge(trx, { conceptId: conceptC.id, topicId: topicAi.id, workspaceId })

  return { conceptA, conceptB, conceptC, note, tag, topicAi, topicDb }
}

async function seedTopicWithConcepts(
  trx: any,
  workspaceId: string,
  topicName: string,
  concepts: Array<{ name: string, mentionCount: number }>,
) {
  await ensureNotesGraphCatalog(trx)

  const note = await trx
    .insertInto('notes')
    .values({
      workspace_id: workspaceId,
      path: '/topic/main.md',
      title: 'Topic Note',
      content: 'x',
      content_hash: 'hash-topic',
      status: 'ingested',
    })
    .returning(['id'])
    .executeTakeFirstOrThrow()

  const topic = await trx
    .insertInto('topics')
    .values({ workspace_id: workspaceId, name: topicName, name_normalized: topicName.toLowerCase(), description: '' })
    .returning(['id'])
    .executeTakeFirstOrThrow()

  await mergeTopicNode(trx, { id: topic.id, workspaceId, name: topicName })

  const rows: Array<{ id: string, name: string }> = []
  for (const concept of concepts) {
    const row = await trx
      .insertInto('concepts')
      .values({
        workspace_id: workspaceId,
        name: concept.name,
        name_normalized: concept.name.toLowerCase(),
        description: '',
      })
      .returning(['id'])
      .executeTakeFirstOrThrow()
    rows.push({ id: row.id, name: concept.name })
    await mergeConceptNode(trx, { id: row.id, workspaceId, name: concept.name })
    await mergeGroupedUnderEdge(trx, { conceptId: row.id, topicId: topic.id, workspaceId })
    await trx
      .insertInto('concept_topics')
      .values({ workspace_id: workspaceId, concept_id: row.id, topic_id: topic.id })
      .execute()
    // mentions has a unique (chunk_id, concept_id) constraint: one chunk per mention
    for (let i = 0; i < concept.mentionCount; i++) {
      const chunk = await trx
        .insertInto('chunks')
        .values({ workspace_id: workspaceId, note_id: note.id, seq: i, text: 'x' })
        .returning(['id'])
        .executeTakeFirstOrThrow()
      await trx
        .insertInto('mentions')
        .values({ workspace_id: workspaceId, chunk_id: chunk.id, concept_id: row.id })
        .execute()
    }
  }

  return { topic, rows }
}

describe('graph API', () => {
  describe('gET /api/graph', () => {
    test('returns topic overview: topics + top concepts + edges among included nodes', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      const seeded = await seedGraphDomain(trx, workspace.id)

      const res = await server('/api/graph', { headers: { cookie: cookies } })
      expect(res.status).toBe(200)
      const body = await res.json()

      const nodeIds = new Set(body.nodes.map((n: any) => n.id))
      expect(nodeIds.has(seeded.conceptA.id)).toBe(true)
      expect(nodeIds.has(seeded.conceptB.id)).toBe(true)
      expect(nodeIds.has(seeded.conceptC.id)).toBe(true)
      expect(nodeIds.has(seeded.topicAi.id)).toBe(true)
      expect(nodeIds.has(seeded.topicDb.id)).toBe(true)
      // Notes and Tags are not part of the overview
      expect(nodeIds.has(seeded.note.id)).toBe(false)
      expect(nodeIds.has(seeded.tag.id)).toBe(false)
      expect(body.nodes).toHaveLength(5)

      for (const node of body.nodes) {
        expect(node).toHaveProperty('id')
        expect(node).toHaveProperty('label')
        expect(['Concept', 'Topic']).toContain(node.label)
        expect(node).toHaveProperty('name')
        expect(node).toHaveProperty('ref')
      }

      const conceptNode = body.nodes.find((n: any) => n.id === seeded.conceptA.id)
      expect(conceptNode).toMatchObject({ label: 'Concept', name: 'Graph RAG', ref: seeded.conceptA.id })

      const topicNodeAi = body.nodes.find((n: any) => n.id === seeded.topicAi.id)
      expect(topicNodeAi).toMatchObject({ label: 'Topic', name: 'AI Engineering', ref: seeded.topicAi.id })

      const topicNodeDb = body.nodes.find((n: any) => n.id === seeded.topicDb.id)
      expect(topicNodeDb).toMatchObject({ label: 'Topic', name: 'Databases', ref: seeded.topicDb.id })

      // only GROUPED_UNDER (included concepts) and RELATES_TO (both endpoints included)
      expect(body.edges).toHaveLength(6)
      const grouped = body.edges.filter((e: any) => e.type === 'GROUPED_UNDER')
      expect(grouped).toHaveLength(4)
      const relates = body.edges.filter((e: any) => e.type === 'RELATES_TO')
      expect(relates).toHaveLength(2)

      const groupedUnderEdge = body.edges.find(
        (e: any) => e.source === seeded.conceptA.id && e.target === seeded.topicAi.id && e.type === 'GROUPED_UNDER',
      )
      expect(groupedUnderEdge).toBeTruthy()

      const relatesEdge = body.edges.find(
        (e: any) => e.source === seeded.conceptA.id && e.target === seeded.conceptB.id && e.type === 'RELATES_TO',
      )
      expect(relatesEdge).toBeTruthy()
      expect(relatesEdge.edgeType).toBe('implemented-with')

      expect(body.edges.find((e: any) => e.type === 'MENTIONS')).toBeFalsy()
      expect(body.edges.find((e: any) => e.type === 'TAGGED')).toBeFalsy()
    })

    test('limits to top 10 concepts per topic, ties broken by name asc', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()

      const concepts = [
        ...Array.from({ length: 9 }, (_, i) => ({ name: `Concept 0${i + 1}`, mentionCount: 12 - i })),
        { name: 'Zulu', mentionCount: 3 },
        { name: 'Alpha', mentionCount: 3 },
      ]
      const seeded = await seedTopicWithConcepts(trx, workspace.id, 'Overflow', concepts)

      const res = await server('/api/graph', { headers: { cookie: cookies } })
      expect(res.status).toBe(200)
      const body = await res.json()

      const byName = new Map(seeded.rows.map(r => [r.name, r.id]))
      const nodeIds = new Set(body.nodes.map((n: any) => n.id))
      // 9 high-count concepts + Alpha (wins the count-3 tie on name) + 1 topic node
      expect(body.nodes).toHaveLength(11)
      for (let i = 1; i <= 9; i++)
        expect(nodeIds.has(byName.get(`Concept 0${i}`)!)).toBe(true)
      expect(nodeIds.has(byName.get('Alpha')!)).toBe(true)
      expect(nodeIds.has(byName.get('Zulu')!)).toBe(false)
    })

    test('includes a concept once even when it tops multiple topics', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      await ensureNotesGraphCatalog(trx)

      const note = await trx
        .insertInto('notes')
        .values({ workspace_id: workspace.id, path: '/d.md', title: 'D', content: 'x', content_hash: 'h', status: 'ingested' })
        .returning(['id'])
        .executeTakeFirstOrThrow()

      const shared = await trx
        .insertInto('concepts')
        .values({ workspace_id: workspace.id, name: 'Shared', name_normalized: 'shared', description: '' })
        .returning(['id'])
        .executeTakeFirstOrThrow()
      await mergeConceptNode(trx, { id: shared.id, workspaceId: workspace.id, name: 'Shared' })
      // mentions has a unique (chunk_id, concept_id) constraint: one chunk per mention
      for (let i = 0; i < 50; i++) {
        const chunk = await trx
          .insertInto('chunks')
          .values({ workspace_id: workspace.id, note_id: note.id, seq: i, text: 'x' })
          .returning(['id'])
          .executeTakeFirstOrThrow()
        await trx
          .insertInto('mentions')
          .values({ workspace_id: workspace.id, chunk_id: chunk.id, concept_id: shared.id })
          .execute()
      }

      const fillerNames = ['Alpha Filler', 'Beta Filler']
      for (let i = 0; i < 2; i++) {
        const topicName = `Topic ${i}`
        const topic = await trx
          .insertInto('topics')
          .values({ workspace_id: workspace.id, name: topicName, name_normalized: topicName.toLowerCase(), description: '' })
          .returning(['id'])
          .executeTakeFirstOrThrow()
        await mergeTopicNode(trx, { id: topic.id, workspaceId: workspace.id, name: topicName })
        await mergeGroupedUnderEdge(trx, { conceptId: shared.id, topicId: topic.id, workspaceId: workspace.id })
        await trx
          .insertInto('concept_topics')
          .values({ workspace_id: workspace.id, concept_id: shared.id, topic_id: topic.id })
          .execute()

        const filler = await trx
          .insertInto('concepts')
          .values({ workspace_id: workspace.id, name: fillerNames[i], name_normalized: fillerNames[i].toLowerCase(), description: '' })
          .returning(['id'])
          .executeTakeFirstOrThrow()
        await mergeConceptNode(trx, { id: filler.id, workspaceId: workspace.id, name: fillerNames[i] })
        await mergeGroupedUnderEdge(trx, { conceptId: filler.id, topicId: topic.id, workspaceId: workspace.id })
        await trx
          .insertInto('concept_topics')
          .values({ workspace_id: workspace.id, concept_id: filler.id, topic_id: topic.id })
          .execute()
      }

      const res = await server('/api/graph', { headers: { cookie: cookies } })
      expect(res.status).toBe(200)
      const body = await res.json()

      const sharedNodes = body.nodes.filter((n: any) => n.id === shared.id)
      expect(sharedNodes).toHaveLength(1)
      expect(sharedNodes[0]).toMatchObject({ label: 'Concept', name: 'Shared', ref: shared.id })
      expect(body.nodes).toHaveLength(5) // 2 topics + shared + 2 fillers
    })

    test('excludes topic-less concepts but keeps empty topics', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      await ensureNotesGraphCatalog(trx)

      // concept with a high mention count but no topic membership
      const orphan = await trx
        .insertInto('concepts')
        .values({ workspace_id: workspace.id, name: 'Orphan', name_normalized: 'orphan', description: '' })
        .returning(['id'])
        .executeTakeFirstOrThrow()
      await mergeConceptNode(trx, { id: orphan.id, workspaceId: workspace.id, name: 'Orphan' })
      const note = await trx
        .insertInto('notes')
        .values({ workspace_id: workspace.id, path: '/o.md', title: 'O', content: 'x', content_hash: 'ho', status: 'ingested' })
        .returning(['id'])
        .executeTakeFirstOrThrow()
      // mentions has a unique (chunk_id, concept_id) constraint: one chunk per mention
      for (let i = 0; i < 100; i++) {
        const chunk = await trx
          .insertInto('chunks')
          .values({ workspace_id: workspace.id, note_id: note.id, seq: i, text: 'x' })
          .returning(['id'])
          .executeTakeFirstOrThrow()
        await trx
          .insertInto('mentions')
          .values({ workspace_id: workspace.id, chunk_id: chunk.id, concept_id: orphan.id })
          .execute()
      }

      // an empty topic with no concepts — must still appear
      const emptyTopic = await trx
        .insertInto('topics')
        .values({ workspace_id: workspace.id, name: 'Empty Topic', name_normalized: 'empty topic', description: '' })
        .returning(['id'])
        .executeTakeFirstOrThrow()
      await mergeTopicNode(trx, { id: emptyTopic.id, workspaceId: workspace.id, name: 'Empty Topic' })

      // a populated topic so the overview is non-empty
      const kept = await trx
        .insertInto('concepts')
        .values({ workspace_id: workspace.id, name: 'Kept', name_normalized: 'kept', description: '' })
        .returning(['id'])
        .executeTakeFirstOrThrow()
      await mergeConceptNode(trx, { id: kept.id, workspaceId: workspace.id, name: 'Kept' })
      await mergeGroupedUnderEdge(trx, { conceptId: kept.id, topicId: emptyTopic.id, workspaceId: workspace.id })
      await trx
        .insertInto('concept_topics')
        .values({ workspace_id: workspace.id, concept_id: kept.id, topic_id: emptyTopic.id })
        .execute()

      const res = await server('/api/graph', { headers: { cookie: cookies } })
      expect(res.status).toBe(200)
      const body = await res.json()

      const nodeIds = new Set(body.nodes.map((n: any) => n.id))
      expect(nodeIds.has(orphan.id)).toBe(false)
      expect(nodeIds.has(kept.id)).toBe(true)
      expect(nodeIds.has(emptyTopic.id)).toBe(true)
    })

    test('returns empty graph when workspace has no graph data', async ({ server, trx }) => {
      const { cookies } = await givenVerifiedUser()
      await ensureNotesGraphCatalog(trx)
      const res = await server('/api/graph', { headers: { cookie: cookies } })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual({ nodes: [], edges: [] })
    })

    test('does not leak other workspaces graph data', async ({ server, trx }) => {
      const { cookies } = await givenVerifiedUser()
      const other = await givenVerifiedUser()
      await seedGraphDomain(trx, other.workspace.id)

      const res = await server('/api/graph', { headers: { cookie: cookies } })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.nodes).toHaveLength(0)
      expect(body.edges).toHaveLength(0)
    })
  })

  describe('gET /api/graph/concepts', () => {
    test('returns concepts ordered by mentionCount desc', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      const seeded = await seedGraphDomain(trx, workspace.id)

      const res = await server('/api/graph/concepts', { headers: { cookie: cookies } })
      expect(res.status).toBe(200)
      const body = await res.json()

      expect(body).toHaveLength(3)
      expect(body[0]).toMatchObject({
        id: seeded.conceptB.id,
        name: 'Kysely',
        description: 'type-safe SQL builder',
        mentionCount: 2,
        topics: ['Databases'],
      })
      expect(body[1]).toMatchObject({
        id: seeded.conceptA.id,
        name: 'Graph RAG',
        mentionCount: 1,
        topics: ['AI Engineering', 'Databases'],
      })
      expect(body[2]).toMatchObject({
        id: seeded.conceptC.id,
        name: 'Embeddings',
        mentionCount: 0,
        topics: ['AI Engineering'],
      })

      for (const concept of body) {
        expect(concept).toHaveProperty('id')
        expect(concept).toHaveProperty('name')
        expect(concept).toHaveProperty('description')
        expect(concept).toHaveProperty('mentionCount')
        expect(typeof concept.mentionCount).toBe('number')
        expect(concept).toHaveProperty('topics')
        expect(Array.isArray(concept.topics)).toBe(true)
      }
    })

    test('does not leak other workspaces concept topics', async ({ server, trx }) => {
      const { cookies } = await givenVerifiedUser()
      const other = await givenVerifiedUser()
      const seeded = await seedGraphDomain(trx, other.workspace.id)

      const res = await server('/api/graph/concepts', { headers: { cookie: cookies } })
      expect(res.status).toBe(200)
      const body = await res.json()

      expect(body).toHaveLength(0)

      const detailRes = await server(`/api/graph/concepts/${seeded.conceptA.id}`, { headers: { cookie: cookies } })
      expect(detailRes.status).toBe(404)
    })
  })

  describe('gET /api/graph/concepts/:id', () => {
    test('returns concept detail with neighbors and mentioned notes', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      const seeded = await seedGraphDomain(trx, workspace.id)

      const res = await server(`/api/graph/concepts/${seeded.conceptA.id}`, { headers: { cookie: cookies } })
      expect(res.status).toBe(200)
      const body = await res.json()

      expect(body.concept).toMatchObject({
        id: seeded.conceptA.id,
        name: 'Graph RAG',
        description: 'retrieval over a knowledge graph',
        topics: ['AI Engineering', 'Databases'],
      })

      const neighborIds = body.neighbors.map((n: any) => n.id)
      expect(neighborIds).toContain(seeded.conceptB.id)
      expect(neighborIds).toContain(seeded.conceptC.id)

      const neighborB = body.neighbors.find((n: any) => n.id === seeded.conceptB.id)
      expect(neighborB).toMatchObject({ name: 'Kysely', type: 'implemented-with' })

      const neighborC = body.neighbors.find((n: any) => n.id === seeded.conceptC.id)
      expect(neighborC).toMatchObject({ name: 'Embeddings', type: 'depends-on' })

      expect(body.mentionedIn).toHaveLength(1)
      expect(body.mentionedIn[0]).toMatchObject({
        path: seeded.note.path,
        title: seeded.note.title,
      })
    })

    test('returns 404 for concepts in another workspace', async ({ server, trx }) => {
      const { cookies } = await givenVerifiedUser()
      const other = await givenVerifiedUser()
      const seeded = await seedGraphDomain(trx, other.workspace.id)

      const res = await server(`/api/graph/concepts/${seeded.conceptA.id}`, { headers: { cookie: cookies } })
      expect(res.status).toBe(404)
    })
  })
})
