import type { DB } from '@monorepo/shared'
import type {
  ChunkRef,
  ConceptRef,
  MentionGapReport,
  MentionRef,
} from '../server/lib/mention-gap'
import { writeFileSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import { findMentionGaps } from '../server/lib/mention-gap'

const appRoot = fileURLToPath(new URL('..', import.meta.url))

dotenv.config({ path: `${appRoot}/.env.local` })

interface CliOptions {
  workspace: string | null
  json: boolean
  threshold: number
  limit: number | null
}

function parseArgs(argv: string[]): CliOptions {
  let workspace: string | null = null
  let json = false
  let threshold = 0
  let limit: number | null = null

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--json') {
      json = true
    }
    else if (arg === '--threshold') {
      threshold = Number.parseInt(argv[++i] ?? '0', 10)
    }
    else if (arg === '--limit') {
      limit = Number.parseInt(argv[++i] ?? '0', 10)
    }
    else if (!arg.startsWith('--')) {
      workspace = arg
    }
  }

  return { workspace, json, threshold, limit }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

async function resolveWorkspaceIds(db: Kysely<DB>, workspace: string | null): Promise<string[]> {
  if (workspace) {
    if (isUuid(workspace)) {
      const row = await db.selectFrom('workspaces').select('id').where('id', '=', workspace).executeTakeFirst()
      if (!row)
        throw new Error(`workspace not found: ${workspace}`)
      return [row.id]
    }

    const rows = await db
      .selectFrom('workspaces')
      .select('id')
      .where('name', 'ilike', workspace)
      .execute()

    if (rows.length === 0)
      throw new Error(`workspace not found by name: ${workspace}`)

    return rows.map(r => r.id)
  }

  const rows = await db.selectFrom('workspaces').select('id').execute()
  return rows.map(r => r.id)
}

async function fetchConcepts(db: Kysely<DB>, workspaceIds: string[]): Promise<ConceptRef[]> {
  const rows = await db
    .selectFrom('concepts')
    .select(['id', 'name', 'workspace_id'])
    .where('workspace_id', 'in', workspaceIds)
    .orderBy('name_normalized')
    .execute()

  return rows.map(r => ({ id: r.id, name: r.name, workspaceId: r.workspace_id }))
}

async function fetchChunks(db: Kysely<DB>, workspaceIds: string[]): Promise<ChunkRef[]> {
  const rows = await db
    .selectFrom('chunks')
    .innerJoin('notes', 'notes.id', 'chunks.note_id')
    .select([
      'chunks.id',
      'chunks.note_id',
      'chunks.text',
      'chunks.workspace_id',
      'notes.title',
      'notes.path',
    ])
    .where('chunks.workspace_id', 'in', workspaceIds)
    .execute()

  return rows.map(r => ({
    id: r.id,
    noteId: r.note_id,
    workspaceId: r.workspace_id,
    text: r.text,
    noteTitle: r.title,
    notePath: r.path,
  }))
}

async function fetchMentions(db: Kysely<DB>, workspaceIds: string[]): Promise<MentionRef[]> {
  const rows = await db
    .selectFrom('mentions')
    .select(['chunk_id', 'concept_id'])
    .where('workspace_id', 'in', workspaceIds)
    .execute()

  return rows.map(r => ({ chunkId: r.chunk_id, conceptId: r.concept_id }))
}

function formatReport(report: MentionGapReport, limit: number | null): string {
  const summaries = limit === null ? report.conceptSummaries : report.conceptSummaries.slice(0, limit)
  if (summaries.length === 0)
    return 'No mention gaps found.'

  const maxName = Math.max(...summaries.map(s => s.conceptName.length), 'concept'.length)
  const lines: string[] = []
  lines.push(
    `${'concept'.padEnd(maxName)} | matching notes | mentioned notes | gap`,
    ''.padEnd(maxName + 38, '-'),
  )

  for (const s of summaries) {
    lines.push(
      `${s.conceptName.padEnd(maxName)} | ${String(s.matchingNotes).padStart(14)} | ${String(s.mentionedNotes).padStart(15)} | ${String(s.gap).padStart(3)}`,
    )
  }

  lines.push('')
  lines.push(`Per-note gaps (${report.noteGaps.length} total):`)
  const detailLimit = limit === null ? report.noteGaps.length : limit
  for (const g of report.noteGaps.slice(0, detailLimit)) {
    lines.push(`- ${g.notePath}: ${g.conceptName}`)
  }

  return lines.join('\n')
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL || process.env.NUXT_DATABASE_URL
  if (!databaseUrl)
    throw new Error('DATABASE_URL or NUXT_DATABASE_URL must be set')

  const options = parseArgs(process.argv.slice(2))

  const pool = new pg.Pool({ connectionString: databaseUrl })
  const db = new Kysely<DB>({
    dialect: new PostgresDialect({ pool }),
  })

  try {
    const workspaceIds = await resolveWorkspaceIds(db, options.workspace)
    const [concepts, chunks, mentions] = await Promise.all([
      fetchConcepts(db, workspaceIds),
      fetchChunks(db, workspaceIds),
      fetchMentions(db, workspaceIds),
    ])

    const report = findMentionGaps(concepts, chunks, mentions)
    const filtered: MentionGapReport = {
      conceptSummaries: report.conceptSummaries.filter(s => s.gap >= options.threshold),
      noteGaps: report.noteGaps.filter((g) => {
        const summary = report.conceptSummaries.find(s => s.conceptId === g.conceptId)
        return summary && summary.gap >= options.threshold
      }),
    }

    const limited: MentionGapReport = {
      conceptSummaries: options.limit === null
        ? filtered.conceptSummaries
        : filtered.conceptSummaries.slice(0, options.limit),
      noteGaps: options.limit === null
        ? filtered.noteGaps
        : filtered.noteGaps.slice(0, options.limit),
    }

    const markdown = formatReport(limited, null)
    const outPath = `${appRoot}/tmp-mention-gap.md`
    writeFileSync(outPath, markdown, 'utf8')

    if (options.json) {
      console.log(JSON.stringify(limited, null, 2))
    }
    else {
      console.log(markdown)
    }
  }
  finally {
    await db.destroy()
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
