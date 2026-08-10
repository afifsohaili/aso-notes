import { describe, expect, it } from 'vitest'
import { createSeqCounter, truncateJsonOutput } from '../../server/lib/observability/trace-writer'

describe('truncateJsonOutput', () => {
  it('returns small values unchanged', () => {
    const value = { foo: 'bar', count: 3 }
    expect(truncateJsonOutput(value)).toEqual(value)
  })

  it('truncates values above the byte limit', () => {
    const big = 'x'.repeat(20_000)
    const value = { note: big }
    const result = truncateJsonOutput(value, 8192) as any

    expect(result.__truncated).toBe(true)
    expect(result.__originalBytes).toBeGreaterThan(8192)
    expect(result.head.length).toBeLessThanOrEqual(8192)
  })

  it('counts bytes, not string length', () => {
    const value = { text: 'é'.repeat(5_000) }
    const result = truncateJsonOutput(value, 8192) as any

    expect(result.__truncated).toBe(true)
    expect(result.__originalBytes).toBeGreaterThan(8192)
  })

  it('passes through null and undefined', () => {
    expect(truncateJsonOutput(null)).toBeNull()
    expect(truncateJsonOutput(undefined)).toBeUndefined()
  })
})

describe('createSeqCounter', () => {
  it('allocates monotonically increasing integers starting at 0', () => {
    const next = createSeqCounter()
    expect(next()).toBe(0)
    expect(next()).toBe(1)
    expect(next()).toBe(2)
  })

  it('can start at a custom offset', () => {
    const next = createSeqCounter(10)
    expect(next()).toBe(10)
    expect(next()).toBe(11)
  })
})
