import type { SmokeTestPhase } from '../../server/lib/onboarding/smoke-test'
import { describe, expect, it } from 'vitest'
import {
  deriveSmokeTestPhase,
  SMOKE_TEST_TIMEOUT_MS,

} from '../../server/lib/onboarding/smoke-test'

/**
 * Unit tests for the smoke-test phase state machine.
 */

describe('deriveSmokeTestPhase', () => {
  it('returns written when the file exists but the note row does not', () => {
    const result = deriveSmokeTestPhase({
      status: null,
      rowExists: false,
      fileExists: true,
      elapsedMs: 0,
      deletionStarted: false,
    })
    expect(result.phase).toBe('written')
  })

  it('maps pending, queued, and processing to their own phases', () => {
    for (const status of ['pending', 'queued', 'processing'] as SmokeTestPhase[]) {
      const result = deriveSmokeTestPhase({
        status,
        rowExists: true,
        fileExists: true,
        elapsedMs: 0,
        deletionStarted: false,
      })
      expect(result.phase).toBe(status)
    }
  })

  it('returns ingested before deletion starts', () => {
    const result = deriveSmokeTestPhase({
      status: 'ingested',
      rowExists: true,
      fileExists: true,
      elapsedMs: 0,
      deletionStarted: false,
    })
    expect(result.phase).toBe('ingested')
  })

  it('returns deleting while the row still exists after deletion started', () => {
    const result = deriveSmokeTestPhase({
      status: 'ingested',
      rowExists: true,
      fileExists: false,
      elapsedMs: 0,
      deletionStarted: true,
    })
    expect(result.phase).toBe('deleting')
  })

  it('returns done once the row is gone after deletion started', () => {
    const result = deriveSmokeTestPhase({
      status: 'ingested',
      rowExists: false,
      fileExists: false,
      elapsedMs: 0,
      deletionStarted: true,
    })
    expect(result.phase).toBe('done')
  })

  it('returns done when the file is already gone and the row never existed', () => {
    const result = deriveSmokeTestPhase({
      status: null,
      rowExists: false,
      fileExists: false,
      elapsedMs: 0,
      deletionStarted: true,
    })
    expect(result.phase).toBe('done')
  })

  it('returns failed for a failed note status', () => {
    const result = deriveSmokeTestPhase({
      status: 'failed',
      rowExists: true,
      fileExists: true,
      elapsedMs: 0,
      deletionStarted: false,
    })
    expect(result.phase).toBe('failed')
  })

  it('times out a pending note after the configured threshold', () => {
    const result = deriveSmokeTestPhase({
      status: 'pending',
      rowExists: true,
      fileExists: true,
      elapsedMs: SMOKE_TEST_TIMEOUT_MS + 1,
      deletionStarted: false,
    })
    expect(result.phase).toBe('failed')
    expect(result.error).toContain('Timed out')
  })

  it('times out a written note that never reached the queue', () => {
    const result = deriveSmokeTestPhase({
      status: null,
      rowExists: false,
      fileExists: true,
      elapsedMs: SMOKE_TEST_TIMEOUT_MS + 1,
      deletionStarted: false,
    })
    expect(result.phase).toBe('failed')
    expect(result.error).toContain('Timed out')
  })

  it('returns failed when the file was removed before ingestion completed', () => {
    const result = deriveSmokeTestPhase({
      status: null,
      rowExists: false,
      fileExists: false,
      elapsedMs: 0,
      deletionStarted: false,
    })
    expect(result.phase).toBe('failed')
    expect(result.error).toContain('removed before')
  })
})
