import { test } from '@base/testing/test'
import { sql } from 'kysely'
import { describe, expect } from 'vitest'
import { ensureNotesGraphCatalog } from './age-catalog'

/**
 * M1 feature spec: the notes-domain schema (plan-002-system data model).
 * There are no API endpoints in M1 — the schema itself is the deliverable,
 * so these tests exercise tables, constraints, cascades, indexes, and the
 * AGE graph directly through the database seam.
 */

const NOTES_DOMAIN_TABLES = [
  'folders',
  'notes',
  'chunks',
  'concepts',
  'relations',
  'mentions',
  'tags',
  'note_tags',
  'note_tag_dismissals',
  'links',
  'sources',
  'conversations',
  'messages',
  'topics',
  'concept_topics',
  'workspace_settings',
  'synced_folders',
] as const

const EXPECTED_COLUMNS: Record<string, string[]> = {
  folders: ['id', 'workspace_id', 'path', 'cover_content', 'cover_hash', 'created_at', 'updated_at'],
  notes: ['id', 'workspace_id', 'synced_folder_id', 'folder_id', 'path', 'title', 'content', 'content_hash', 'ingested_hash', 'status', 'pipeline', 'last_run', 'created_at', 'updated_at'],
  chunks: ['id', 'workspace_id', 'note_id', 'seq', 'text', 'token_count', 'embedding', 'created_at', 'updated_at'],
  concepts: ['id', 'workspace_id', 'name', 'name_normalized', 'description', 'embedding', 'created_at', 'updated_at'],
  relations: ['id', 'workspace_id', 'from_concept_id', 'to_concept_id', 'type', 'description', 'created_at', 'updated_at'],
  mentions: ['id', 'workspace_id', 'chunk_id', 'concept_id'],
  tags: ['id', 'workspace_id', 'name', 'name_normalized', 'created_at', 'updated_at'],
  note_tags: ['workspace_id', 'note_id', 'tag_id', 'origin'],
  note_tag_dismissals: ['workspace_id', 'note_id', 'tag_id', 'created_at'],
  links: ['id', 'workspace_id', 'from_note_id', 'to_note_id', 'raw_target', 'created_at', 'updated_at'],
  sources: ['id', 'workspace_id', 'note_id', 'url', 'url_normalized', 'title', 'type', 'created_at', 'updated_at'],
  conversations: ['id', 'workspace_id', 'title', 'created_at', 'updated_at'],
  messages: ['id', 'workspace_id', 'conversation_id', 'role', 'content', 'tool_calls', 'tool_call_id', 'created_at'],
  topics: ['id', 'workspace_id', 'name', 'name_normalized', 'description', 'embedding', 'created_at', 'updated_at'],
  concept_topics: ['workspace_id', 'concept_id', 'topic_id'],
  workspace_settings: ['workspace_id', 'key', 'value', 'updated_at'],
  synced_folders: ['id', 'workspace_id', 'path', 'created_at', 'updated_at'],
}

async function columnMap(trx: any) {
  const { rows } = await sql<{ table_name: string, column_name: string }>`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
  `.execute(trx)
  const map = new Map<string, Set<string>>()
  for (const row of rows) {
    if (!map.has(row.table_name))
      map.set(row.table_name, new Set())
    map.get(row.table_name)!.add(row.column_name)
  }
  return map
}

async function rowCount(trx: any, table: string): Promise<number> {
  const { rows } = await sql<{ c: number }>`
    SELECT count(*)::int AS c FROM ${sql.table(table)}
  `.execute(trx)
  return rows[0]!.c
}

/**
 * Asserts that fn() fails with a DB error. Each test runs in a single
 * transaction, and Postgres poisons the whole transaction on error — so the
 * failing statement is wrapped in a savepoint that is rolled back on failure,
 * keeping the rest of the test usable.
 */
async function expectDbError(trx: any, fn: () => Promise<unknown>): Promise<void> {
  await sql`SAVEPOINT expect_db_error`.execute(trx)
  try {
    await fn()
  }
  catch {
    await sql`ROLLBACK TO SAVEPOINT expect_db_error`.execute(trx)
    return
  }
  throw new Error('expected statement to fail, but it succeeded')
}

async function givenWorkspace(trx: any, name: string): Promise<string> {
  const row = await trx
    .insertInto('workspaces')
    .values({ name })
    .returning('id')
    .executeTakeFirstOrThrow()
  return row.id
}

async function givenNote(trx: any, workspaceId: string, path: string): Promise<string> {
  const row = await trx
    .insertInto('notes')
    .values({ workspace_id: workspaceId, path, title: path })
    .returning('id')
    .executeTakeFirstOrThrow()
  return row.id
}

async function givenChunk(trx: any, workspaceId: string, noteId: string, seq = 0): Promise<string> {
  const row = await trx
    .insertInto('chunks')
    .values({ workspace_id: workspaceId, note_id: noteId, seq, text: `chunk ${seq}` })
    .returning('id')
    .executeTakeFirstOrThrow()
  return row.id
}

async function givenConcept(trx: any, workspaceId: string, name: string): Promise<string> {
  const row = await trx
    .insertInto('concepts')
    .values({ workspace_id: workspaceId, name, name_normalized: name.toLowerCase() })
    .returning('id')
    .executeTakeFirstOrThrow()
  return row.id
}

async function givenTopic(trx: any, workspaceId: string, name: string): Promise<string> {
  const row = await trx
    .insertInto('topics')
    .values({ workspace_id: workspaceId, name, name_normalized: name.toLowerCase() })
    .returning('id')
    .executeTakeFirstOrThrow()
  return row.id
}

async function givenConceptTopic(trx: any, workspaceId: string, conceptId: string, topicId: string): Promise<void> {
  await sql`
    INSERT INTO concept_topics (workspace_id, concept_id, topic_id)
    VALUES (${workspaceId}, ${conceptId}, ${topicId})
  `.execute(trx)
}

async function givenWorkspaceSetting(trx: any, workspaceId: string, key: string, value: Record<string, unknown>): Promise<void> {
  await sql`
    INSERT INTO workspace_settings (workspace_id, key, value)
    VALUES (${workspaceId}, ${key}, ${JSON.stringify(value)}::jsonb)
  `.execute(trx)
}

async function updateWorkspaceSetting(trx: any, workspaceId: string, key: string, value: Record<string, unknown>): Promise<void> {
  await sql`
    INSERT INTO workspace_settings (workspace_id, key, value)
    VALUES (${workspaceId}, ${key}, ${JSON.stringify(value)}::jsonb)
    ON CONFLICT (workspace_id, key) DO UPDATE SET value = EXCLUDED.value
  `.execute(trx)
}

async function selectWorkspaceSettingValue(trx: any, workspaceId: string, key: string): Promise<Record<string, unknown>> {
  const { rows } = await sql<{ value: Record<string, unknown> }>`
    SELECT value FROM workspace_settings WHERE workspace_id = ${workspaceId} AND key = ${key}
  `.execute(trx)
  return rows[0]!.value
}

async function expectUniqueViolation(trx: any, workspaceId: string, key: string, value: Record<string, unknown>): Promise<void> {
  await expectDbError(trx, () =>
    sql`
      INSERT INTO workspace_settings (workspace_id, key, value)
      VALUES (${workspaceId}, ${key}, ${JSON.stringify(value)}::jsonb)
    `.execute(trx))
}

describe('notes domain schema (M1)', () => {
  test('all notes-domain tables exist with expected columns', async ({ trx }) => {
    const map = await columnMap(trx)
    for (const table of NOTES_DOMAIN_TABLES) {
      expect(map.has(table), `missing table: ${table}`).toBe(true)
      for (const column of EXPECTED_COLUMNS[table]!) {
        expect(map.get(table)!.has(column), `missing column: ${table}.${column}`).toBe(true)
      }
    }
  })

  test('embedding columns are halfvec(2048)', async ({ trx }) => {
    for (const table of ['chunks', 'concepts', 'topics'] as const) {
      const { rows } = await sql<{ formatted: string }>`
        SELECT format_type(a.atttypid, a.atttypmod) AS formatted
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = ${table}
          AND a.attname = 'embedding'
      `.execute(trx)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.formatted).toBe('halfvec(2048)')
    }
  })

  test('notes.status and note_tags.origin reject values outside the allowed sets, and queued/processing are allowed', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'checks')

    await expectDbError(trx, () =>
      trx.insertInto('notes').values({ workspace_id: workspaceId, path: '/a.md', title: 'a', status: 'bogus' }).execute())

    const noteId = await givenNote(trx, workspaceId, '/b.md')
    const tag = await trx
      .insertInto('tags')
      .values({ workspace_id: workspaceId, name: 'T', name_normalized: 't' })
      .returning('id')
      .executeTakeFirstOrThrow()

    await expectDbError(trx, () =>
      trx.insertInto('note_tags').values({ workspace_id: workspaceId, note_id: noteId, tag_id: tag.id, origin: 'robot' }).execute())

    // allowed values succeed, including the new queue lifecycle states
    await trx.insertInto('note_tags').values({ workspace_id: workspaceId, note_id: noteId, tag_id: tag.id, origin: 'ai' }).execute()
    await trx.updateTable('notes').set({ status: 'queued' }).where('id', '=', noteId).execute()
    await trx.updateTable('notes').set({ status: 'processing' }).where('id', '=', noteId).execute()
    expect(await rowCount(trx, 'note_tags')).toBe(1)
  })

  test('notes.pipeline defaults to markdown-note and notes.status defaults to pending', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'defaults')
    const noteId = await givenNote(trx, workspaceId, '/defaults.md')
    const note = await trx
      .selectFrom('notes')
      .select(['status', 'pipeline'])
      .where('id', '=', noteId)
      .executeTakeFirstOrThrow()
    expect(note.status).toBe('pending')
    expect(note.pipeline).toBe('markdown-note')
  })

  test('concepts.name_normalized is unique per workspace but reusable across workspaces', async ({ trx }) => {
    const wsA = await givenWorkspace(trx, 'ws-a')
    const wsB = await givenWorkspace(trx, 'ws-b')

    await givenConcept(trx, wsA, 'Graph RAG')
    await expectDbError(trx, () => givenConcept(trx, wsA, 'graph rag'))

    // same normalized name in a different workspace is fine
    const other = await givenConcept(trx, wsB, 'graph rag')
    expect(other).toBeTruthy()
  })

  test('notes.path is unique per synced folder but reusable across synced folders', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'ws-a')

    const rootA = await trx
      .insertInto('synced_folders')
      .values({ workspace_id: workspaceId, path: '/root-a' })
      .returning('id')
      .executeTakeFirstOrThrow()
    const rootB = await trx
      .insertInto('synced_folders')
      .values({ workspace_id: workspaceId, path: '/root-b' })
      .returning('id')
      .executeTakeFirstOrThrow()

    await trx
      .insertInto('notes')
      .values({ workspace_id: workspaceId, synced_folder_id: rootA.id, path: '/inbox/a.md', title: 'a' })
      .execute()

    // duplicate path within the same synced folder is rejected
    await expectDbError(trx, () =>
      trx.insertInto('notes').values({ workspace_id: workspaceId, synced_folder_id: rootA.id, path: '/inbox/a.md', title: 'a' }).execute())

    // the same relative path in a different synced folder is allowed
    await trx
      .insertInto('notes')
      .values({ workspace_id: workspaceId, synced_folder_id: rootB.id, path: '/inbox/a.md', title: 'a' })
      .execute()
    expect(await rowCount(trx, 'notes')).toBe(2)
  })

  test('composite uniques reject duplicates (mentions, note_tags, sources)', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'uniques')
    const noteId = await givenNote(trx, workspaceId, '/u.md')
    const chunkId = await givenChunk(trx, workspaceId, noteId)
    const conceptId = await givenConcept(trx, workspaceId, 'Dup')

    await trx.insertInto('mentions').values({ workspace_id: workspaceId, chunk_id: chunkId, concept_id: conceptId }).execute()
    await expectDbError(trx, () =>
      trx.insertInto('mentions').values({ workspace_id: workspaceId, chunk_id: chunkId, concept_id: conceptId }).execute())

    const tag = await trx
      .insertInto('tags')
      .values({ workspace_id: workspaceId, name: 'T', name_normalized: 't' })
      .returning('id')
      .executeTakeFirstOrThrow()
    await trx.insertInto('note_tags').values({ workspace_id: workspaceId, note_id: noteId, tag_id: tag.id, origin: 'user' }).execute()
    await expectDbError(trx, () =>
      trx.insertInto('note_tags').values({ workspace_id: workspaceId, note_id: noteId, tag_id: tag.id, origin: 'ai' }).execute())

    const source = { workspace_id: workspaceId, note_id: noteId, url: 'https://x.com/a', url_normalized: 'x.com/a' }
    await trx.insertInto('sources').values(source).execute()
    await expectDbError(trx, () => trx.insertInto('sources').values(source).execute())
  })

  test('mentions are cascade-deleted when their chunk is deleted', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'mentions-cascade')
    const noteId = await givenNote(trx, workspaceId, '/m.md')
    const chunkId = await givenChunk(trx, workspaceId, noteId)
    const conceptId = await givenConcept(trx, workspaceId, 'Cascade')
    await trx.insertInto('mentions').values({ workspace_id: workspaceId, chunk_id: chunkId, concept_id: conceptId }).execute()
    expect(await rowCount(trx, 'mentions')).toBe(1)

    await trx.deleteFrom('chunks').where('id', '=', chunkId).execute()
    expect(await rowCount(trx, 'mentions')).toBe(0)
    // the concept itself survives — only the mention is chunk-scoped
    expect(await rowCount(trx, 'concepts')).toBe(1)
  })

  test('deleting a workspace cascade-deletes the whole notes domain', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'doomed')

    const folder = await trx
      .insertInto('folders')
      .values({ workspace_id: workspaceId, path: '/proj' })
      .returning('id')
      .executeTakeFirstOrThrow()
    const noteId = await givenNote(trx, workspaceId, '/proj/a.md')
    const chunkId = await givenChunk(trx, workspaceId, noteId)
    const conceptA = await givenConcept(trx, workspaceId, 'Alpha')
    const conceptB = await givenConcept(trx, workspaceId, 'Beta')
    await trx.insertInto('relations').values({ workspace_id: workspaceId, from_concept_id: conceptA, to_concept_id: conceptB, type: 'relates' }).execute()
    await trx.insertInto('mentions').values({ workspace_id: workspaceId, chunk_id: chunkId, concept_id: conceptA }).execute()
    const tag = await trx
      .insertInto('tags')
      .values({ workspace_id: workspaceId, name: 'Tag', name_normalized: 'tag' })
      .returning('id')
      .executeTakeFirstOrThrow()
    await trx.insertInto('note_tags').values({ workspace_id: workspaceId, note_id: noteId, tag_id: tag.id, origin: 'ai' }).execute()
    await trx.insertInto('note_tag_dismissals').values({ workspace_id: workspaceId, note_id: noteId, tag_id: tag.id }).execute()
    await trx.insertInto('links').values({ workspace_id: workspaceId, from_note_id: noteId, to_note_id: null, raw_target: 'ghost' }).execute()
    await trx.insertInto('sources').values({ workspace_id: workspaceId, note_id: noteId, url: 'https://x.com', url_normalized: 'x.com' }).execute()
    await givenWorkspaceSetting(trx, workspaceId, 'extraction.vocabulary_strategy', { strategy: 'top-k' })
    const conversation = await trx
      .insertInto('conversations')
      .values({ workspace_id: workspaceId, title: 'chat' })
      .returning('id')
      .executeTakeFirstOrThrow()
    await trx.insertInto('messages').values({ workspace_id: workspaceId, conversation_id: conversation.id, role: 'user', content: 'hi' }).execute()

    expect(folder.id).toBeTruthy()
    await trx.deleteFrom('workspaces').where('id', '=', workspaceId).execute()

    for (const table of NOTES_DOMAIN_TABLES) {
      expect(await rowCount(trx, table), `expected ${table} to be empty after workspace delete`).toBe(0)
    }
  })

  test('expected indexes exist (HNSW cosine, sweeper, FK lookups)', async ({ trx }) => {
    const { rows } = await sql<{ tablename: string, indexname: string, indexdef: string }>`
      SELECT tablename, indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
    `.execute(trx)

    const findIndex = (table: string, match: RegExp) =>
      rows.find(r => r.tablename === table && match.test(r.indexdef))

    expect(findIndex('chunks', /hnsw.*halfvec_cosine_ops/i), 'chunks embedding HNSW').toBeTruthy()
    expect(findIndex('concepts', /hnsw.*halfvec_cosine_ops/i), 'concepts embedding HNSW').toBeTruthy()
    expect(findIndex('topics', /hnsw.*halfvec_cosine_ops/i), 'topics embedding HNSW').toBeTruthy()
    expect(findIndex('notes', /\(status, updated_at\)/), 'notes sweeper index').toBeTruthy()
    expect(findIndex('chunks', /\(note_id\)/), 'chunks(note_id)').toBeTruthy()
    expect(findIndex('mentions', /\(concept_id\)/), 'mentions(concept_id)').toBeTruthy()
    expect(findIndex('links', /\(from_note_id\)/), 'links(from_note_id)').toBeTruthy()
    expect(findIndex('links', /\(to_note_id\)/), 'links(to_note_id)').toBeTruthy()
    expect(findIndex('messages', /\(conversation_id\)/), 'messages(conversation_id)').toBeTruthy()
  })

  test('topics.name_normalized is unique per workspace but reusable across workspaces', async ({ trx }) => {
    const wsA = await givenWorkspace(trx, 'ws-a')
    const wsB = await givenWorkspace(trx, 'ws-b')

    await givenTopic(trx, wsA, 'Billing')
    await expectDbError(trx, () => givenTopic(trx, wsA, 'billing'))

    const other = await givenTopic(trx, wsB, 'billing')
    expect(other).toBeTruthy()
  })

  test('concept_topics cascades on concept delete', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'cascade-concept')
    const conceptId = await givenConcept(trx, workspaceId, 'Paddle')
    const topicId = await givenTopic(trx, workspaceId, 'Payments')

    await givenConceptTopic(trx, workspaceId, conceptId, topicId)
    expect(await rowCount(trx, 'concept_topics')).toBe(1)

    await trx.deleteFrom('concepts').where('id', '=', conceptId).execute()
    expect(await rowCount(trx, 'concept_topics')).toBe(0)
    expect(await rowCount(trx, 'topics')).toBe(1)
  })

  test('concept_topics cascades on topic delete', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'cascade-topic')
    const conceptId = await givenConcept(trx, workspaceId, 'Stripe')
    const topicId = await givenTopic(trx, workspaceId, 'Payments')

    await givenConceptTopic(trx, workspaceId, conceptId, topicId)
    expect(await rowCount(trx, 'concept_topics')).toBe(1)

    await trx.deleteFrom('topics').where('id', '=', topicId).execute()
    expect(await rowCount(trx, 'concept_topics')).toBe(0)
    expect(await rowCount(trx, 'concepts')).toBe(1)
  })

  test('workspace_settings stores jsonb and supports upsert by (workspace_id, key)', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'settings')

    await givenWorkspaceSetting(trx, workspaceId, 'extraction.vocabulary_strategy', { strategy: 'top-k' })

    const first = await selectWorkspaceSettingValue(trx, workspaceId, 'extraction.vocabulary_strategy')
    expect(first).toEqual({ strategy: 'top-k' })

    await expectUniqueViolation(trx, workspaceId, 'extraction.vocabulary_strategy', { strategy: 'blind-merge' })

    await updateWorkspaceSetting(trx, workspaceId, 'extraction.vocabulary_strategy', { strategy: 'blind-merge' })

    const second = await selectWorkspaceSettingValue(trx, workspaceId, 'extraction.vocabulary_strategy')
    expect(second).toEqual({ strategy: 'blind-merge' })
  })

  test('notes.last_run stores jsonb and is nullable', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'last-run')
    const noteId = await givenNote(trx, workspaceId, '/lr.md')

    const before = await trx
      .selectFrom('notes')
      .select('last_run')
      .where('id', '=', noteId)
      .executeTakeFirstOrThrow()
    expect(before.last_run).toBeNull()

    const payload = {
      pipeline: 'markdown-note-with-links',
      status: 'succeeded',
      failed_stage: null,
      error: null,
      attempt: 1,
      job_id: null,
      started_at: '2026-07-29T10:00:00.000Z',
      finished_at: '2026-07-29T10:00:01.000Z',
      duration_ms: 1000,
      chunks: 2,
      extraction: null,
    }

    await sql`
      UPDATE notes SET last_run = ${JSON.stringify(payload)}::jsonb WHERE id = ${noteId}
    `.execute(trx)

    const after = await trx
      .selectFrom('notes')
      .select('last_run')
      .where('id', '=', noteId)
      .executeTakeFirstOrThrow()
    expect(after.last_run).toEqual(payload)
  })

  test('AGE graph notes_graph exists', async ({ trx }) => {
    // The e2e template DB is provisioned from db/schema.sql (pg_dump
    // --schema-only), which carries the notes_graph schema + label tables
    // created by the migration but not the AGE catalog rows (catalog data).
    // Backfill them idempotently so the catalog query below runs; the
    // schema-level assertion is what proves the migration created the graph.
    await ensureNotesGraphCatalog(trx)

    const { rows: schemas } = await sql<{ schema_name: string }>`
      SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'notes_graph'
    `.execute(trx)
    expect(schemas, 'migration should create the notes_graph schema via create_graph').toHaveLength(1)

    const { rows: graphs } = await sql<{ name: string }>`
      SELECT * FROM ag_catalog.ag_graph WHERE name = 'notes_graph'
    `.execute(trx)
    expect(graphs).toHaveLength(1)
  })
})
