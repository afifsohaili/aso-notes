import type { Json } from '@monorepo/shared'
import type { SyncDb } from '../sync/sweeper'
import { randomUUID } from 'node:crypto'
import { access, constants, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { sql } from 'kysely'

export const SMOKE_TEST_FILENAME = '__aso-smoke-test.md'
export const SMOKE_TEST_CONTENT = [
  '# Aso Notes smoke test',
  '',
  'This note was written by the app to verify that ingestion works end-to-end.',
  'It exercises extraction with a single heading, one sentence, and no wikilinks.',
].join('\n')

export const SMOKE_TEST_TIMEOUT_MS = 3 * 60 * 1000

export type SmokeTestPhase = 'written' | 'pending' | 'queued' | 'processing' | 'ingested' | 'deleting' | 'done' | 'failed'

export interface SmokeTestAttempt {
  attemptId: string
  workspaceId: string
  folderId: string
  folderPath: string
  filePath: string
  startedAt: number
  deletionStarted: boolean
}

interface SmokeTestNoteRow {
  id: string
  status: string
  last_run: Json
}

const attempts = new Map<string, SmokeTestAttempt>()

/** Reset in-memory attempts. Exported for tests only. */
export function resetSmokeTestAttempts(): void {
  attempts.clear()
}

export interface SmokeTestPrerequisites {
  redisUrl: string | undefined
  syncedFolder: { id: string, path: string } | null
}

export async function checkSmokeTestPrerequisites(db: SyncDb, workspaceId: string): Promise<SmokeTestPrerequisites> {
  const folder = await db
    .selectFrom('synced_folders')
    .select(['id', 'path'])
    .where('workspace_id', '=', workspaceId)
    .orderBy('created_at', 'asc')
    .executeTakeFirst()

  return {
    redisUrl: process.env.NUXT_REDIS_URL,
    syncedFolder: folder ?? null,
  }
}

export interface SmokeTestStartFailure {
  code: 'redis_required' | 'no_synced_folder'
  message: string
}

export type SmokeTestStartResult = { kind: 'started', attempt: SmokeTestAttempt } | SmokeTestStartFailure

export async function startSmokeTest(db: SyncDb, workspaceId: string): Promise<SmokeTestStartResult> {
  const { redisUrl, syncedFolder } = await checkSmokeTestPrerequisites(db, workspaceId)

  if (!redisUrl) {
    return {
      code: 'redis_required',
      message: 'Redis is not configured. The smoke test needs a working ingestion queue (NUXT_REDIS_URL).',
    }
  }

  if (!syncedFolder) {
    return {
      code: 'no_synced_folder',
      message: 'Add a Synced Folder before running the smoke test.',
    }
  }

  const filePath = path.resolve(syncedFolder.path, SMOKE_TEST_FILENAME)

  // Clean up any stale smoke test file or row from a previous attempt so a
  // retry starts fresh.
  await deleteSmokeTestFile(filePath)
  await db
    .deleteFrom('notes')
    .where('synced_folder_id', '=', syncedFolder.id)
    .where('path', '=', `/${SMOKE_TEST_FILENAME}`)
    .execute()

  await writeFile(filePath, SMOKE_TEST_CONTENT, 'utf8')

  const attempt: SmokeTestAttempt = {
    attemptId: randomUUID(),
    workspaceId,
    folderId: syncedFolder.id,
    folderPath: syncedFolder.path,
    filePath,
    startedAt: Date.now(),
    deletionStarted: false,
  }
  attempts.set(workspaceId, attempt)

  return { kind: 'started', attempt }
}

export interface SmokeTestPhaseInput {
  status: string | null
  rowExists: boolean
  fileExists: boolean
  elapsedMs: number
  deletionStarted: boolean
}

export interface SmokeTestPhaseResult {
  phase: SmokeTestPhase
  error?: string
}

export function deriveSmokeTestPhase(input: SmokeTestPhaseInput): SmokeTestPhaseResult {
  const { status, rowExists, fileExists, elapsedMs, deletionStarted } = input

  if (status === 'failed') {
    return { phase: 'failed' }
  }

  if (status === 'ingested') {
    if (!deletionStarted) {
      return { phase: 'ingested' }
    }
    if (rowExists) {
      return { phase: 'deleting' }
    }
    if (fileExists) {
      return { phase: 'deleting' }
    }
    return { phase: 'done' }
  }

  if (status === 'pending' || status === 'queued' || status === 'processing') {
    if (elapsedMs > SMOKE_TEST_TIMEOUT_MS) {
      return {
        phase: 'failed',
        error: 'Timed out after 3 minutes waiting for the smoke test note to be ingested.',
      }
    }
    return { phase: status as SmokeTestPhase }
  }

  if (!rowExists) {
    if (fileExists) {
      if (elapsedMs > SMOKE_TEST_TIMEOUT_MS) {
        return {
          phase: 'failed',
          error: 'Timed out after 3 minutes waiting for the smoke test note to be ingested.',
        }
      }
      return { phase: 'written' }
    }

    if (deletionStarted) {
      return { phase: 'done' }
    }

    if (elapsedMs > SMOKE_TEST_TIMEOUT_MS) {
      return {
        phase: 'failed',
        error: 'Timed out after 3 minutes. The smoke test file was removed before ingestion completed.',
      }
    }

    return {
      phase: 'failed',
      error: 'The smoke test file was removed before it could be ingested.',
    }
  }

  return { phase: 'failed', error: `Unknown note status: ${status}` }
}

export interface SmokeTestState {
  phase: SmokeTestPhase
  error?: string
  lastRun?: Json
}

export interface SmokeTestStaleFailure {
  code: 'stale_attempt'
  message: string
}

export type SmokeTestStateResult = SmokeTestState | SmokeTestStaleFailure

export async function getSmokeTestState(
  db: SyncDb,
  workspaceId: string,
  attemptId: string,
): Promise<SmokeTestStateResult> {
  const attempt = attempts.get(workspaceId)
  if (!attempt || attempt.attemptId !== attemptId) {
    return {
      code: 'stale_attempt',
      message: 'This smoke test attempt is stale or was cancelled. Start a new verification.',
    }
  }

  const elapsed = Date.now() - attempt.startedAt
  const note = await findSmokeTestNote(db, attempt.folderId)
  const rowExists = note != null
  const fileExists = await fileExistsAsync(attempt.filePath)

  let errorFromRun: string | undefined
  if (note && note.status === 'failed') {
    errorFromRun = extractLastRunError(note.last_run)
  }

  const derived = deriveSmokeTestPhase({
    status: note?.status ?? null,
    rowExists,
    fileExists,
    elapsedMs: elapsed,
    deletionStarted: attempt.deletionStarted,
  })

  if (derived.phase === 'ingested') {
    await deleteSmokeTestFile(attempt.filePath)
    attempt.deletionStarted = true
    return { phase: 'ingested', error: errorFromRun, ...(note ? { lastRun: note.last_run } : {}) }
  }

  if (derived.phase === 'done') {
    await completeOnboarding(db, workspaceId)
  }

  return { phase: derived.phase, error: errorFromRun ?? derived.error, ...(note ? { lastRun: note.last_run } : {}) }
}

export async function completeOnboarding(db: SyncDb, workspaceId: string): Promise<void> {
  const existing = await db
    .selectFrom('workspace_settings')
    .select('value')
    .where('workspace_id', '=', workspaceId)
    .where('key', '=', 'onboarding.completed_at')
    .executeTakeFirst()

  if (existing)
    return

  const now = new Date().toISOString()
  await db
    .insertInto('workspace_settings')
    .values({
      workspace_id: workspaceId,
      key: 'onboarding.completed_at',
      value: sql`to_jsonb(${now}::text)`,
    })
    .execute()
}

async function findSmokeTestNote(db: SyncDb, folderId: string): Promise<SmokeTestNoteRow | null> {
  const row = await db
    .selectFrom('notes')
    .select(['id', 'status', 'last_run'])
    .where('synced_folder_id', '=', folderId)
    .where('path', '=', `/${SMOKE_TEST_FILENAME}`)
    .executeTakeFirst()

  return row ?? null
}

async function fileExistsAsync(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK)
    return true
  }
  catch {
    return false
  }
}

async function deleteSmokeTestFile(filePath: string): Promise<void> {
  try {
    await unlink(filePath)
  }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return
    throw error
  }
}

function extractLastRunError(lastRun: Json): string {
  if (lastRun && typeof lastRun === 'object' && !Array.isArray(lastRun)) {
    const run = lastRun as Record<string, Json>
    if (run.error && typeof run.error === 'object' && !Array.isArray(run.error)) {
      const error = run.error as Record<string, Json>
      if (typeof error.message === 'string')
        return error.message
    }
    if (typeof run.status === 'string' && run.status === 'failed')
      return 'Ingestion failed. Check the ingestion run detail for more information.'
  }
  return 'Ingestion failed.'
}
