import { describe, expect, it } from 'vitest'
import { approxTokens, chunkMarkdown } from '../../server/lib/pipeline/chunker'

const TARGET_CHARS = 500 * 4 // ~500 tokens at 4 chars/token

function paragraph(id: string, sentences: number): string {
  // each sentence is ~95 chars so a 5-sentence paragraph is ~480 chars
  return Array.from(
    { length: sentences },
    (_, i) => `${id} sentence ${i} lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor.`,
  ).join(' ')
}

describe('approxTokens', () => {
  it('approximates 4 characters per token', () => {
    expect(approxTokens('abcd')).toBe(1)
    expect(approxTokens('abcde')).toBe(2)
    expect(approxTokens('')).toBe(0)
  })
})

describe('chunkMarkdown', () => {
  it('returns no chunks for an empty document', () => {
    expect(chunkMarkdown('')).toEqual([])
    expect(chunkMarkdown('   \n\n  ')).toEqual([])
  })

  it('returns a single chunk for a tiny note without headings', () => {
    const chunks = chunkMarkdown('just a small note')
    expect(chunks).toHaveLength(1)
    expect(chunks[0]!.text).toBe('just a small note')
    expect(chunks[0]!.headingPath).toEqual([])
    expect(chunks[0]!.index).toBe(0)
    expect(chunks[0]!.tokenCount).toBe(approxTokens('just a small note'))
  })

  it('propagates the nested heading path to each chunk', () => {
    // bodies large enough that sections cannot merge into one chunk
    const body = 'x'.repeat(1200)
    const doc = [
      '# Alpha',
      body,
      '## Beta',
      body,
      '### Gamma',
      body,
      '# Delta',
      body,
    ].join('\n')
    const chunks = chunkMarkdown(doc)
    const byText = new Map(chunks.map(c => [c.text.split('\n')[0], c]))
    expect(byText.get('# Alpha')!.headingPath).toEqual(['Alpha'])
    expect(byText.get('## Beta')!.headingPath).toEqual(['Alpha', 'Beta'])
    expect(byText.get('### Gamma')!.headingPath).toEqual(['Alpha', 'Beta', 'Gamma'])
    expect(byText.get('# Delta')!.headingPath).toEqual(['Delta'])
  })

  it('merges tiny heading sections into one chunk', () => {
    const doc = [
      '# One',
      'a',
      '## Two',
      'b',
      '## Three',
      'c',
    ].join('\n')
    const chunks = chunkMarkdown(doc)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]!.text).toContain('# One')
    expect(chunks[0]!.text).toContain('## Two')
    expect(chunks[0]!.text).toContain('## Three')
    // merged chunk carries the most specific (last) section's heading path
    expect(chunks[0]!.headingPath).toEqual(['One', 'Three'])
  })

  it('keeps preamble content before the first heading with an empty path', () => {
    const doc = ['preamble text', '# Head', 'body text'].join('\n')
    const chunks = chunkMarkdown(doc)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]!.text).toContain('preamble text')
  })

  it('splits a huge heading section at paragraph boundaries with sentence overlap', () => {
    // 8 paragraphs × ~500 chars each → section far above the ~2000-char target.
    const paragraphs = Array.from({ length: 8 }, (_, i) => paragraph(`P${i}`, 5))
    const doc = `# Big\n\n${paragraphs.join('\n\n')}`
    const chunks = chunkMarkdown(doc)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.headingPath).toEqual(['Big'])
      expect(chunk.text.length).toBeLessThanOrEqual(TARGET_CHARS + 200) // target + slack for overlap/heading
    }
    // every sub-chunk carries the heading for context
    for (const chunk of chunks) {
      expect(chunk.text.startsWith('# Big')).toBe(true)
    }
    // consecutive sub-chunks share a 1-sentence overlap: the last sentence of
    // chunk n reappears at the start of chunk n+1's body
    for (let i = 1; i < chunks.length; i++) {
      const prevBody = chunks[i - 1]!.text.replace(/^# Big\n\n?/, '')
      const lastSentence = prevBody.split(/(?<=[.!?])\s+/).pop()!
      const body = chunks[i]!.text.replace(/^# Big\n\n?/, '')
      expect(body.startsWith(lastSentence)).toBe(true)
    }
  })

  it('falls back to fixed ~500-token windows with 15% overlap for non-markdown text', () => {
    // deterministic distinct-content pattern so overlap is verifiable
    const unit = '0123456789'
    const text = unit.repeat(500) // 5000 chars, no headings
    const overlapChars = Math.floor(TARGET_CHARS * 0.15)
    const chunks = chunkMarkdown(text)

    expect(chunks.length).toBe(3)
    expect(chunks[0]!.text).toBe(text.slice(0, TARGET_CHARS))
    expect(chunks[1]!.text).toBe(text.slice(TARGET_CHARS - overlapChars, TARGET_CHARS * 2 - overlapChars))
    expect(chunks[1]!.text.slice(0, overlapChars)).toBe(chunks[0]!.text.slice(-overlapChars))
    for (const chunk of chunks) {
      expect(chunk.headingPath).toEqual([])
    }
  })

  it('assigns sequential indexes across merged and split chunks', () => {
    const paragraphs = Array.from({ length: 8 }, (_, i) => paragraph(`P${i}`, 5))
    const doc = ['# Small', 'tiny', '# Big', '', paragraphs.join('\n\n')].join('\n')
    const chunks = chunkMarkdown(doc)
    chunks.forEach((chunk, i) => expect(chunk.index).toBe(i))
  })
})
