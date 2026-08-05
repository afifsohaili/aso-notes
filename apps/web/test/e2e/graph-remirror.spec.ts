import { givenVerifiedUser } from '@base/testing/auth'
import { test } from '@base/testing/test'
import { describe, expect } from 'vitest'
import { parseAgtype, queryCypher } from '../../server/lib/graph/age'
import { remirrorGraph } from '../../server/lib/graph/remirror'
import { ensureNotesGraphCatalog } from './age-catalog'

async function seedMinimalGraph(trx: any, workspaceId: string) {
  const note = await trx
    .insertInto('notes')
    .values({
      workspace_id: workspaceId,
      path: '/note.md',
      title: 'Note',
      content: 'content',
      content_hash: 'hash-note',
      status: 'ingested',
    })
    .returning(['id'])
    .executeTakeFirstOrThrow()

  const chunk = await trx
    .insertInto('chunks')
    .values({ workspace_id: workspaceId, note_id: note.id, seq: 0, text: 'chunk' })
    .returning(['id'])
    .executeTakeFirstOrThrow()

  const conceptA = await trx
    .insertInto('concepts')
    .values({ workspace_id: workspaceId, name: 'Concept A', name_normalized: 'concept a', description: 'a' })
    .returning(['id', 'name'])
    .executeTakeFirstOrThrow()

  const conceptB = await trx
    .insertInto('concepts')
    .values({ workspace_id: workspaceId, name: 'Concept B', name_normalized: 'concept b', description: 'b' })
    .returning(['id', 'name'])
    .executeTakeFirstOrThrow()

  const topicX = await trx
    .insertInto('topics')
    .values({ workspace_id: workspaceId, name: 'Topic X', name_normalized: 'topic x', description: 'x' })
    .returning(['id', 'name'])
    .executeTakeFirstOrThrow()

  const topicY = await trx
    .insertInto('topics')
    .values({ workspace_id: workspaceId, name: 'Topic Y', name_normalized: 'topic y', description: 'y' })
    .returning(['id', 'name'])
    .executeTakeFirstOrThrow()

  await trx.insertInto('mentions').values([
    { workspace_id: workspaceId, chunk_id: chunk.id, concept_id: conceptA.id },
    { workspace_id: workspaceId, chunk_id: chunk.id, concept_id: conceptB.id },
  ]).execute()

  await trx.insertInto('relations').values({
    workspace_id: workspaceId,
    from_concept_id: conceptA.id,
    to_concept_id: conceptB.id,
    type: 'relates-to',
    description: '',
  }).execute()

  await trx.insertInto('concept_topics').values([
    { workspace_id: workspaceId, concept_id: conceptA.id, topic_id: topicX.id },
    { workspace_id: workspaceId, concept_id: conceptA.id, topic_id: topicY.id },
    { workspace_id: workspaceId, concept_id: conceptB.id, topic_id: topicX.id },
  ]).execute()

  return { note, chunk, conceptA, conceptB, topicX, topicY }
}

async function vertexCount(trx: any, workspaceId: string, label: string): Promise<number> {
  const rows = await queryCypher<{ n: unknown }>(
    trx,
    `MATCH (n:${label} {workspace_id: '${workspaceId}'}) RETURN count(n) AS n`,
    'n ag_catalog.agtype',
  )
  return Number(rows[0]!.n)
}

async function edgeCount(trx: any, workspaceId: string, type: string): Promise<number> {
  const rows = await queryCypher<{ n: unknown }>(
    trx,
    `MATCH ()-[r:${type} {workspace_id: '${workspaceId}'}]->() RETURN count(r) AS n`,
    'n ag_catalog.agtype',
  )
  return Number(rows[0]!.n)
}

describe('remirrorGraph', () => {
  test('re-mirrors concepts, topics, relations, mentions and concept_topics into AGE', async ({ trx }) => {
    const { workspace } = await givenVerifiedUser()
    await ensureNotesGraphCatalog(trx)
    const seeded = await seedMinimalGraph(trx, workspace.id)

    const counts = await remirrorGraph(trx, workspace.id)
    expect(counts).toEqual({
      concepts: 2,
      topics: 2,
      noteVertices: 1,
      mentions: 2,
      relations: 1,
      conceptTopics: 3,
    })

    expect(await vertexCount(trx, workspace.id, 'Concept')).toBe(2)
    expect(await vertexCount(trx, workspace.id, 'Topic')).toBe(2)
    expect(await vertexCount(trx, workspace.id, 'Note')).toBe(1)
    expect(await edgeCount(trx, workspace.id, 'MENTIONS')).toBe(2)
    expect(await edgeCount(trx, workspace.id, 'RELATES_TO')).toBe(1)
    expect(await edgeCount(trx, workspace.id, 'GROUPED_UNDER')).toBe(3)

    const conceptAName = await queryCypher<{ name: unknown }>(
      trx,
      `MATCH (n:Concept {id: '${seeded.conceptA.id}'}) RETURN n.name AS name`,
      'name ag_catalog.agtype',
    )
    expect(parseAgtype(conceptAName[0]!.name)).toBe('Concept A')

    const topicXName = await queryCypher<{ name: unknown }>(
      trx,
      `MATCH (n:Topic {id: '${seeded.topicX.id}'}) RETURN n.name AS name`,
      'name ag_catalog.agtype',
    )
    expect(parseAgtype(topicXName[0]!.name)).toBe('Topic X')
  })

  test('is idempotent', async ({ trx }) => {
    const { workspace } = await givenVerifiedUser()
    await ensureNotesGraphCatalog(trx)
    await seedMinimalGraph(trx, workspace.id)

    await remirrorGraph(trx, workspace.id)
    const first = {
      concepts: await vertexCount(trx, workspace.id, 'Concept'),
      topics: await vertexCount(trx, workspace.id, 'Topic'),
      notes: await vertexCount(trx, workspace.id, 'Note'),
      mentions: await edgeCount(trx, workspace.id, 'MENTIONS'),
      relatesTo: await edgeCount(trx, workspace.id, 'RELATES_TO'),
      groupedUnder: await edgeCount(trx, workspace.id, 'GROUPED_UNDER'),
    }

    await remirrorGraph(trx, workspace.id)
    const second = {
      concepts: await vertexCount(trx, workspace.id, 'Concept'),
      topics: await vertexCount(trx, workspace.id, 'Topic'),
      notes: await vertexCount(trx, workspace.id, 'Note'),
      mentions: await edgeCount(trx, workspace.id, 'MENTIONS'),
      relatesTo: await edgeCount(trx, workspace.id, 'RELATES_TO'),
      groupedUnder: await edgeCount(trx, workspace.id, 'GROUPED_UNDER'),
    }

    expect(second).toEqual(first)
  })

  test('handles an empty workspace', async ({ trx }) => {
    const { workspace } = await givenVerifiedUser()
    await ensureNotesGraphCatalog(trx)

    const counts = await remirrorGraph(trx, workspace.id)
    expect(counts).toEqual({
      concepts: 0,
      topics: 0,
      noteVertices: 0,
      mentions: 0,
      relations: 0,
      conceptTopics: 0,
    })

    expect(await vertexCount(trx, workspace.id, 'Concept')).toBe(0)
    expect(await vertexCount(trx, workspace.id, 'Topic')).toBe(0)
  })

  test('mirrors orphan concepts with no topics', async ({ trx }) => {
    const { workspace } = await givenVerifiedUser()
    await ensureNotesGraphCatalog(trx)

    await trx
      .insertInto('concepts')
      .values({ workspace_id: workspace.id, name: 'Orphan', name_normalized: 'orphan', description: '' })
      .execute()

    const counts = await remirrorGraph(trx, workspace.id)
    expect(counts.concepts).toBe(1)
    expect(counts.topics).toBe(0)
    expect(counts.conceptTopics).toBe(0)

    expect(await vertexCount(trx, workspace.id, 'Concept')).toBe(1)
    expect(await vertexCount(trx, workspace.id, 'Topic')).toBe(0)
  })

  test('does not touch another workspace', async ({ trx }) => {
    const { workspace } = await givenVerifiedUser()
    const other = await givenVerifiedUser()
    await ensureNotesGraphCatalog(trx)
    const seeded = await seedMinimalGraph(trx, other.workspace.id)

    // Establish AGE state for the other workspace first.
    await remirrorGraph(trx, other.workspace.id)

    await remirrorGraph(trx, workspace.id)

    expect(await vertexCount(trx, other.workspace.id, 'Concept')).toBe(2)
    expect(await vertexCount(trx, other.workspace.id, 'Topic')).toBe(2)
    expect(await vertexCount(trx, other.workspace.id, 'Note')).toBe(1)
    expect(await edgeCount(trx, other.workspace.id, 'MENTIONS')).toBe(2)
    expect(await edgeCount(trx, other.workspace.id, 'RELATES_TO')).toBe(1)
    expect(await edgeCount(trx, other.workspace.id, 'GROUPED_UNDER')).toBe(3)

    const otherConcept = await queryCypher<{ name: unknown }>(
      trx,
      `MATCH (n:Concept {id: '${seeded.conceptA.id}'}) RETURN n.name AS name`,
      'name ag_catalog.agtype',
    )
    expect(parseAgtype(otherConcept[0]!.name)).toBe('Concept A')
  })

  test('collapses multi-chunk mentions into one MENTIONS edge', async ({ trx }) => {
    const { workspace } = await givenVerifiedUser()
    await ensureNotesGraphCatalog(trx)

    const note = await trx
      .insertInto('notes')
      .values({
        workspace_id: workspace.id,
        path: '/note.md',
        title: 'Note',
        content: 'content',
        content_hash: 'hash-note',
        status: 'ingested',
      })
      .returning(['id'])
      .executeTakeFirstOrThrow()

    const chunk1 = await trx
      .insertInto('chunks')
      .values({ workspace_id: workspace.id, note_id: note.id, seq: 0, text: 'c1' })
      .returning(['id'])
      .executeTakeFirstOrThrow()

    const chunk2 = await trx
      .insertInto('chunks')
      .values({ workspace_id: workspace.id, note_id: note.id, seq: 1, text: 'c2' })
      .returning(['id'])
      .executeTakeFirstOrThrow()

    const concept = await trx
      .insertInto('concepts')
      .values({ workspace_id: workspace.id, name: 'Single', name_normalized: 'single', description: '' })
      .returning(['id'])
      .executeTakeFirstOrThrow()

    await trx.insertInto('mentions').values([
      { workspace_id: workspace.id, chunk_id: chunk1.id, concept_id: concept.id },
      { workspace_id: workspace.id, chunk_id: chunk2.id, concept_id: concept.id },
    ]).execute()

    const counts = await remirrorGraph(trx, workspace.id)
    expect(counts.mentions).toBe(1)
    expect(counts.noteVertices).toBe(1)
    expect(await edgeCount(trx, workspace.id, 'MENTIONS')).toBe(1)
  })
})
