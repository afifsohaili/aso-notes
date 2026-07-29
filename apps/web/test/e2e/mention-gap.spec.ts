import type { ChunkRef, ConceptRef, MentionRef } from '../../server/lib/mention-gap'
import { test } from '@base/testing/test'
import { describe, expect } from 'vitest'
import {

  findMentionGaps,

} from '../../server/lib/mention-gap'

/**
 * M6 feature spec: mention-gap report core against a real Postgres database.
 * The seam under test is the pure `findMentionGaps` function fed by real rows.
 */

async function givenWorkspace(trx: any, name: string): Promise<string> {
  const row = await trx
    .insertInto('workspaces')
    .values({ name })
    .returning('id')
    .executeTakeFirstOrThrow()
  return row.id
}

async function givenNote(trx: any, workspaceId: string, path: string, content: string) {
  return trx
    .insertInto('notes')
    .values({
      workspace_id: workspaceId,
      path,
      title: path,
      content,
      content_hash: `hash-${path}`,
      status: 'ingested',
    })
    .returning(['id', 'path', 'title'])
    .executeTakeFirstOrThrow()
}

async function givenChunk(trx: any, workspaceId: string, noteId: string, text: string) {
  return trx
    .insertInto('chunks')
    .values({
      workspace_id: workspaceId,
      note_id: noteId,
      seq: 0,
      text,
    })
    .returning(['id', 'text'])
    .executeTakeFirstOrThrow()
}

async function givenConcept(trx: any, workspaceId: string, name: string) {
  return trx
    .insertInto('concepts')
    .values({
      workspace_id: workspaceId,
      name,
      name_normalized: name.toLowerCase(),
    })
    .returning(['id', 'name'])
    .executeTakeFirstOrThrow()
}

async function loadReportRows(trx: any, workspaceId: string) {
  const conceptRows = await trx
    .selectFrom('concepts')
    .select(['id', 'name', 'workspace_id'])
    .where('workspace_id', '=', workspaceId)
    .execute()

  const chunkRows = await trx
    .selectFrom('chunks')
    .innerJoin('notes', 'notes.id', 'chunks.note_id')
    .select([
      'chunks.id',
      'chunks.note_id',
      'chunks.workspace_id',
      'chunks.text',
      'notes.title',
      'notes.path',
    ])
    .where('chunks.workspace_id', '=', workspaceId)
    .execute()

  const mentionRows = await trx
    .selectFrom('mentions')
    .select(['chunk_id', 'concept_id'])
    .where('workspace_id', '=', workspaceId)
    .execute()

  const concepts: ConceptRef[] = conceptRows.map(r => ({
    id: r.id,
    name: r.name,
    workspaceId: r.workspace_id,
  }))

  const chunks: ChunkRef[] = chunkRows.map(r => ({
    id: r.id,
    noteId: r.note_id,
    workspaceId: r.workspace_id,
    text: r.text,
    noteTitle: r.title,
    notePath: r.path,
  }))

  const mentions: MentionRef[] = mentionRows.map(r => ({
    chunkId: r.chunk_id,
    conceptId: r.concept_id,
  }))

  return findMentionGaps(concepts, chunks, mentions)
}

describe('mention-gap report (M6)', () => {
  test('reports a missing mention when chunk text matches a concept variant', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'm6-gap')
    const note = await givenNote(trx, workspaceId, '/billing/paddle.md', 'paddle_id is required')
    await givenChunk(trx, workspaceId, note.id, 'The paddle_id field is required for checkout.')
    const concept = await givenConcept(trx, workspaceId, 'Paddle')

    const report = await loadReportRows(trx, workspaceId)

    expect(report.conceptSummaries).toHaveLength(1)
    expect(report.conceptSummaries[0]).toMatchObject({
      conceptId: concept.id,
      conceptName: 'Paddle',
      matchingNotes: 1,
      mentionedNotes: 0,
      gap: 1,
    })
    expect(report.noteGaps).toHaveLength(1)
    expect(report.noteGaps[0]).toMatchObject({
      noteId: note.id,
      conceptId: concept.id,
      conceptName: 'Paddle',
    })
  })

  test('does not report a gap once a mention row exists', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'm6-no-gap')
    const note = await givenNote(trx, workspaceId, '/billing/paddle.md', 'paddle_id is required')
    const chunk = await givenChunk(trx, workspaceId, note.id, 'The paddle_id field is required for checkout.')
    const concept = await givenConcept(trx, workspaceId, 'Paddle')

    await trx
      .insertInto('mentions')
      .values({
        workspace_id: workspaceId,
        chunk_id: chunk.id,
        concept_id: concept.id,
      })
      .execute()

    const report = await loadReportRows(trx, workspaceId)

    expect(report.conceptSummaries).toHaveLength(0)
    expect(report.noteGaps).toHaveLength(0)
  })

  test('matches multi-word concepts across separators', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'm6-multi-word')
    const note = await givenNote(trx, workspaceId, '/engineering/graph.md', 'Graph RAG overview')
    await givenChunk(trx, workspaceId, note.id, 'GraphRAG improves retrieval accuracy.')
    await givenConcept(trx, workspaceId, 'Graph RAG')

    const report = await loadReportRows(trx, workspaceId)

    expect(report.conceptSummaries).toHaveLength(1)
    expect(report.conceptSummaries[0]).toMatchObject({
      conceptName: 'Graph RAG',
      matchingNotes: 1,
      gap: 1,
    })
  })
})
