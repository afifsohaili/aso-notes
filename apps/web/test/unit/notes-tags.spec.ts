import { describe, expect, it } from 'vitest'
import { normalizeTagName, tagRemovalDismissalAction } from '../../server/lib/notes/tags'

describe('normalizeTagName', () => {
  it('lowercases and collapses whitespace/punctuation into a single space', () => {
    expect(normalizeTagName('  Graph   RAG! ')).toBe('graph rag')
  })

  it('trims leading and trailing whitespace', () => {
    expect(normalizeTagName('  AI Agents  ')).toBe('ai agents')
  })

  it('returns empty string for empty input', () => {
    expect(normalizeTagName('')).toBe('')
  })
})

describe('tagRemovalDismissalAction', () => {
  it('requires a dismissal when removing an AI-suggested tag', () => {
    expect(tagRemovalDismissalAction('ai')).toBe('dismiss')
  })

  it('does not require a dismissal when removing a user-added tag', () => {
    expect(tagRemovalDismissalAction('user')).toBe('none')
  })
})
