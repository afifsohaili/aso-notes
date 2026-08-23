import { describe, expect, it } from 'vitest'
import { didEmbeddingModelChange } from '../../app/utils/embedding-model-change'

describe('didEmbeddingModelChange', () => {
  it('returns false when previous and next are the same', () => {
    expect(didEmbeddingModelChange('model-a', 'model-a')).toBe(false)
  })

  it('returns false when both are empty', () => {
    expect(didEmbeddingModelChange('', '')).toBe(false)
  })

  it('returns false when the values differ only by surrounding whitespace', () => {
    expect(didEmbeddingModelChange('model-a', '  model-a  ')).toBe(false)
  })

  it('returns true when the model changes to a different value', () => {
    expect(didEmbeddingModelChange('model-a', 'model-b')).toBe(true)
  })

  it('returns true when switching from empty to a model', () => {
    expect(didEmbeddingModelChange(null, 'model-a')).toBe(true)
  })

  it('returns true when clearing a model', () => {
    expect(didEmbeddingModelChange('model-a', null)).toBe(true)
  })

  it('returns false when both are null or undefined', () => {
    expect(didEmbeddingModelChange(null, undefined)).toBe(false)
  })
})
