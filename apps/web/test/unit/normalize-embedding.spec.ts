import { describe, expect, it } from 'vitest'
import { normalizeEmbeddingDimensions } from '../../server/lib/ai/normalize-embedding'
import { EMBEDDING_DIMENSIONS } from '../../server/lib/ai/types'

describe('normalizeEmbeddingDimensions', () => {
  it('pads a 768-dim vector to 2048, preserving the first 768 values', () => {
    const input = Array.from({ length: 768 }, (_, i) => i / 1000)
    const result = normalizeEmbeddingDimensions(input)

    expect(result).toHaveLength(EMBEDDING_DIMENSIONS)
    expect(result.slice(0, 768)).toEqual(input)
    expect(result.slice(768)).toEqual(Array.from({ length: 1280 }).fill(0))
  })

  it('passes through an exactly-2048 vector unchanged', () => {
    const input = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => i)
    const result = normalizeEmbeddingDimensions(input)

    expect(result).toHaveLength(EMBEDDING_DIMENSIONS)
    expect(result).toEqual(input)
    expect(result).toBe(input)
  })

  it('throws a clear error on a vector longer than 2048', () => {
    const input = Array.from({ length: 4096 }).fill(0.1)

    expect(() => normalizeEmbeddingDimensions(input)).toThrow(
      /4096 dimensions, above the 2048 target/,
    )
  })

  it('pads an empty vector to 2048 zeros', () => {
    const result = normalizeEmbeddingDimensions([])

    expect(result).toHaveLength(EMBEDDING_DIMENSIONS)
    expect(result).toEqual(Array.from({ length: EMBEDDING_DIMENSIONS }).fill(0))
  })

  it('pads 2047 to 2048', () => {
    const input = Array.from({ length: 2047 }).fill(0.5)
    const result = normalizeEmbeddingDimensions(input)

    expect(result).toHaveLength(2048)
    expect(result[2047]).toBe(0)
  })

  it('throws on 2049', () => {
    const input = Array.from({ length: 2049 }).fill(0.1)

    expect(() => normalizeEmbeddingDimensions(input)).toThrow(/2049 dimensions/)
  })

  it('honors a custom target dimension', () => {
    const input = [0.1, 0.2]
    const result = normalizeEmbeddingDimensions(input, 4)

    expect(result).toEqual([0.1, 0.2, 0, 0])
  })
})
