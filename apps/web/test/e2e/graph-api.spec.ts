import { givenVerifiedUser } from '@base/testing/auth'
import { test } from '@base/testing/test'
import { describe, expect } from 'vitest'
import {
  mergeConceptNode,
  mergeMentionsEdge,
  mergeNoteNode,
  mergeRelatesToEdge,
  mergeTaggedEdge,
  mergeTagNode,
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

  return { conceptA, conceptB, conceptC, note, tag }
}

describe('graph API', () => {
  describe('gET /api/graph', () => {
    test('returns full workspace-scoped graph payload', async ({ server, trx }) => {
      const { workspace, cookies } = await givenVerifiedUser()
      const seeded = await seedGraphDomain(trx, workspace.id)

      const res = await server('/api/graph', { headers: { cookie: cookies } })
      expect(res.status).toBe(200)
      const body = await res.json()

      const nodeIds = new Set(body.nodes.map((n: any) => n.id))
      expect(nodeIds.has(seeded.conceptA.id)).toBe(true)
      expect(nodeIds.has(seeded.conceptB.id)).toBe(true)
      expect(nodeIds.has(seeded.conceptC.id)).toBe(true)
      expect(nodeIds.has(seeded.note.id)).toBe(true)
      expect(nodeIds.has(seeded.tag.id)).toBe(true)

      expect(body.nodes).toHaveLength(5)
      for (const node of body.nodes) {
        expect(node).toHaveProperty('id')
        expect(node).toHaveProperty('label')
        expect(['Concept', 'Note', 'Tag']).toContain(node.label)
        expect(node).toHaveProperty('name')
        expect(node).toHaveProperty('ref')
      }

      const conceptNode = body.nodes.find((n: any) => n.id === seeded.conceptA.id)
      expect(conceptNode).toMatchObject({ label: 'Concept', name: 'Graph RAG', ref: seeded.conceptA.id })

      const noteNode = body.nodes.find((n: any) => n.id === seeded.note.id)
      expect(noteNode).toMatchObject({ label: 'Note', name: 'Main Note', ref: seeded.note.path })

      const tagNode = body.nodes.find((n: any) => n.id === seeded.tag.id)
      expect(tagNode).toMatchObject({ label: 'Tag', name: 'AI', ref: seeded.tag.id })

      expect(body.edges.length).toBeGreaterThanOrEqual(5)
      const relatesEdge = body.edges.find(
        (e: any) => e.source === seeded.conceptA.id && e.target === seeded.conceptB.id && e.type === 'RELATES_TO',
      )
      expect(relatesEdge).toBeTruthy()
      expect(relatesEdge.edgeType).toBe('implemented-with')

      const mentionsEdge = body.edges.find(
        (e: any) => e.source === seeded.note.id && e.target === seeded.conceptA.id && e.type === 'MENTIONS',
      )
      expect(mentionsEdge).toBeTruthy()

      const taggedEdge = body.edges.find(
        (e: any) => e.source === seeded.note.id && e.target === seeded.tag.id && e.type === 'TAGGED',
      )
      expect(taggedEdge).toBeTruthy()
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
      })
      expect(body[1]).toMatchObject({
        id: seeded.conceptA.id,
        name: 'Graph RAG',
        mentionCount: 1,
      })
      expect(body[2]).toMatchObject({
        id: seeded.conceptC.id,
        name: 'Embeddings',
        mentionCount: 0,
      })

      for (const concept of body) {
        expect(concept).toHaveProperty('id')
        expect(concept).toHaveProperty('name')
        expect(concept).toHaveProperty('description')
        expect(concept).toHaveProperty('mentionCount')
        expect(typeof concept.mentionCount).toBe('number')
      }
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
