import { describe, expect, it } from 'vitest'
import { isRebuildConfirmation } from '../../app/utils/rebuild-confirm'

describe('isRebuildConfirmation', () => {
  it('accepts the exact string REBUILD', () => {
    expect(isRebuildConfirmation('REBUILD')).toBe(true)
  })

  it('rejects lowercase', () => {
    expect(isRebuildConfirmation('rebuild')).toBe(false)
  })

  it('rejects mixed case', () => {
    expect(isRebuildConfirmation('Rebuild')).toBe(false)
  })

  it('rejects surrounding whitespace', () => {
    expect(isRebuildConfirmation(' REBUILD ')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isRebuildConfirmation('')).toBe(false)
  })

  it('rejects other text', () => {
    expect(isRebuildConfirmation('DELETE EVERYTHING')).toBe(false)
  })
})
