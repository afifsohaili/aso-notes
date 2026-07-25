import type { DB } from '@monorepo/shared'
import process from 'node:process'
import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import {
  mergeConceptNode,
  mergeMentionsEdge,
  mergeNoteNode,
  mergeRelatesToEdge,
  mergeTaggedEdge,
  mergeTagNode,
} from '../server/lib/graph/helpers'
import { ensureNotesGraphCatalog } from '../test/e2e/age-catalog'

const workspaceId = process.argv[2]
if (!workspaceId) {
  console.error('Usage: vite-node scripts/seed-graph-dev.ts <workspaceId>')
  process.exit(1)
}

async function main() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
  })

  const db = new Kysely<DB>({
    dialect: new PostgresDialect({ pool }),
  })

  await ensureNotesGraphCatalog(db)

  // Clean up any previous seed for this workspace
  await db.deleteFrom('mentions').where('workspace_id', '=', workspaceId).execute()
  await db.deleteFrom('relations').where('workspace_id', '=', workspaceId).execute()
  await db.deleteFrom('chunks').where('workspace_id', '=', workspaceId).execute()
  await db.deleteFrom('note_tags').where('workspace_id', '=', workspaceId).execute()
  await db.deleteFrom('links').where('workspace_id', '=', workspaceId).execute()
  await db.deleteFrom('sources').where('workspace_id', '=', workspaceId).execute()
  await db.deleteFrom('concepts').where('workspace_id', '=', workspaceId).execute()
  await db.deleteFrom('tags').where('workspace_id', '=', workspaceId).execute()
  await db.deleteFrom('notes').where('workspace_id', '=', workspaceId).execute()

  const conceptA = await db
    .insertInto('concepts')
    .values({
      workspace_id: workspaceId,
      name: 'Graph RAG',
      name_normalized: 'graph rag',
      description: 'retrieval over a knowledge graph',
    })
    .returning(['id', 'name'])
    .executeTakeFirstOrThrow()

  const conceptB = await db
    .insertInto('concepts')
    .values({
      workspace_id: workspaceId,
      name: 'Kysely',
      name_normalized: 'kysely',
      description: 'type-safe SQL builder',
    })
    .returning(['id', 'name'])
    .executeTakeFirstOrThrow()

  const conceptC = await db
    .insertInto('concepts')
    .values({
      workspace_id: workspaceId,
      name: 'Embeddings',
      name_normalized: 'embeddings',
      description: 'vector representations',
    })
    .returning(['id', 'name'])
    .executeTakeFirstOrThrow()

  const note = await db
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

  const chunk1 = await db
    .insertInto('chunks')
    .values({
      workspace_id: workspaceId,
      note_id: note.id,
      seq: 0,
      text: 'Graph RAG uses Kysely.',
    })
    .returning('id')
    .executeTakeFirstOrThrow()

  const chunk2 = await db
    .insertInto('chunks')
    .values({
      workspace_id: workspaceId,
      note_id: note.id,
      seq: 1,
      text: 'Kysely is great.',
    })
    .returning('id')
    .executeTakeFirstOrThrow()

  await db
    .insertInto('mentions')
    .values([
      { workspace_id: workspaceId, chunk_id: chunk1.id, concept_id: conceptA.id },
      { workspace_id: workspaceId, chunk_id: chunk1.id, concept_id: conceptB.id },
      { workspace_id: workspaceId, chunk_id: chunk2.id, concept_id: conceptB.id },
    ])
    .execute()

  await db
    .insertInto('relations')
    .values([
      {
        workspace_id: workspaceId,
        from_concept_id: conceptA.id,
        to_concept_id: conceptB.id,
        type: 'implemented-with',
        description: '',
      },
      {
        workspace_id: workspaceId,
        from_concept_id: conceptC.id,
        to_concept_id: conceptA.id,
        type: 'depends-on',
        description: '',
      },
    ])
    .execute()

  const tag = await db
    .insertInto('tags')
    .values({ workspace_id: workspaceId, name: 'AI', name_normalized: 'ai' })
    .returning(['id', 'name'])
    .executeTakeFirstOrThrow()

  await db
    .insertInto('note_tags')
    .values({ workspace_id: workspaceId, note_id: note.id, tag_id: tag.id, origin: 'ai' })
    .execute()

  await mergeConceptNode(db, { id: conceptA.id, workspaceId, name: conceptA.name })
  await mergeConceptNode(db, { id: conceptB.id, workspaceId, name: conceptB.name })
  await mergeConceptNode(db, { id: conceptC.id, workspaceId, name: conceptC.name })
  await mergeNoteNode(db, { id: note.id, workspaceId })
  await mergeTagNode(db, { id: tag.id, workspaceId, name: tag.name })
  await mergeRelatesToEdge(db, { fromId: conceptA.id, toId: conceptB.id, type: 'implemented-with', workspaceId })
  await mergeRelatesToEdge(db, { fromId: conceptC.id, toId: conceptA.id, type: 'depends-on', workspaceId })
  await mergeMentionsEdge(db, { noteId: note.id, conceptId: conceptA.id, workspaceId })
  await mergeMentionsEdge(db, { noteId: note.id, conceptId: conceptB.id, workspaceId })
  await mergeTaggedEdge(db, { noteId: note.id, tagId: tag.id, workspaceId })

  console.log(`Seeded workspace ${workspaceId}: ${conceptA.id} ${conceptB.id} ${conceptC.id} ${note.id} ${tag.id}`)
  await db.destroy()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
