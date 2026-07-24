/**
 * Markdown-aware chunker (plan-002-system §Ingestion pipeline).
 *
 * Splits a note on ATX headings, greedily merges tiny sections up to the
 * ~500-token target, subdivides oversized sections at paragraph boundaries
 * with a 1-sentence overlap, and falls back to fixed ~500-token windows with
 * 15% overlap for content with no headings at all.
 *
 * Token counting is approximate (`tokenizer: 'approx'`): 4 chars per token.
 */

export interface PipelineChunk {
  index: number
  text: string
  tokenCount: number
  headingPath: string[]
  embedding?: number[]
}

export interface ChunkerOptions {
  /** Target chunk size in approximate tokens. Defaults to 500. */
  targetTokens?: number
}

const CHARS_PER_TOKEN = 4
const DEFAULT_TARGET_TOKENS = 500
const OVERLAP_RATIO = 0.15
/** A carried-over overlap sentence may use at most this fraction of the target. */
const OVERLAP_BUDGET_RATIO = 0.25

export function approxTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

interface Section {
  headingLine: string | null
  headingPath: string[]
  text: string
}

const HEADING_RE = /^(#{1,6})\s+(\S.*)$/

function splitSections(content: string): Section[] {
  const sections: Section[] = []
  const headingStack: { level: number, title: string }[] = []
  let current: { headingLine: string | null, headingPath: string[], lines: string[] } | null = null

  const flush = () => {
    if (!current)
      return
    const text = current.lines.join('\n').trim()
    if (text) {
      sections.push({
        headingLine: current.headingLine,
        headingPath: current.headingPath,
        text: current.headingLine ? `${current.headingLine}\n${text}`.trim() : text,
      })
    }
  }

  for (const line of content.split('\n')) {
    const match = line.match(HEADING_RE)
    if (match) {
      flush()
      const level = match[1]!.length
      const title = match[2]!.trim()
      while (headingStack.length > 0 && headingStack[headingStack.length - 1]!.level >= level)
        headingStack.pop()
      headingStack.push({ level, title })
      current = { headingLine: line.trim(), headingPath: headingStack.map(h => h.title), lines: [] }
    }
    else {
      if (!current)
        current = { headingLine: null, headingPath: [], lines: [] }
      current.lines.push(line)
    }
  }
  flush()
  return sections
}

function lastSentence(text: string): string {
  const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.trim())
  return sentences.length > 0 ? sentences[sentences.length - 1]! : ''
}

/** Fixed ~target-char windows with 15% character overlap (non-markdown fallback). */
function fixedWindows(text: string, targetChars: number): string[] {
  const overlapChars = Math.floor(targetChars * OVERLAP_RATIO)
  const step = targetChars - overlapChars
  const windows: string[] = []
  for (let start = 0; start < text.length; start += step) {
    const window = text.slice(start, start + targetChars).trim()
    if (window)
      windows.push(window)
    if (start + targetChars >= text.length)
      break
  }
  return windows
}

/**
 * Subdivide one oversized section at paragraph boundaries. Consecutive
 * sub-chunks share a 1-sentence overlap (the last sentence of the previous
 * sub-chunk) when that sentence fits the overlap budget. A paragraph that is
 * itself oversized is hard-split into fixed windows.
 */
function subdivideSection(section: Section, targetChars: number): string[] {
  const prefix = section.headingLine ? `${section.headingLine}\n\n` : ''
  const body = section.headingLine ? section.text.slice(section.headingLine.length).trim() : section.text
  const paragraphs = body.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)

  const chunks: string[] = []
  let current = prefix

  const fitsCurrent = (addition: string) =>
    (current + addition).length <= targetChars

  for (const para of paragraphs) {
    if (para.length > targetChars) {
      // oversized single paragraph: flush and hard-split
      if (current.trim() && current !== prefix)
        chunks.push(current.trim())
      current = prefix
      for (const window of fixedWindows(para, targetChars - prefix.length))
        chunks.push(`${prefix}${window}`.trim())
      continue
    }
    const candidate = current === prefix ? `${prefix}${para}` : `${current}\n\n${para}`
    if (fitsCurrent(candidate.length > 0 ? candidate : para) && candidate.length <= targetChars) {
      current = candidate
    }
    else {
      chunks.push(current.trim())
      const overlap = lastSentence(current)
      const carry = overlap && overlap.length <= targetChars * OVERLAP_BUDGET_RATIO ? `${overlap} ` : ''
      current = `${prefix}${carry}${para}`
    }
  }
  if (current.trim() && current.trim() !== prefix.trim())
    chunks.push(current.trim())
  return chunks
}

export function chunkMarkdown(content: string, options: ChunkerOptions = {}): PipelineChunk[] {
  const targetTokens = options.targetTokens ?? DEFAULT_TARGET_TOKENS
  const targetChars = targetTokens * CHARS_PER_TOKEN

  const trimmed = content.trim()
  if (!trimmed)
    return []

  const hasHeadings = trimmed.split('\n').some(line => HEADING_RE.test(line))

  const rawChunks: { text: string, headingPath: string[] }[] = []

  if (!hasHeadings) {
    for (const window of trimmed.length <= targetChars ? [trimmed] : fixedWindows(trimmed, targetChars))
      rawChunks.push({ text: window, headingPath: [] })
  }
  else {
    const sections = splitSections(trimmed)
    let current: { text: string, headingPath: string[] } | null = null

    const flush = () => {
      if (current)
        rawChunks.push(current)
      current = null
    }

    for (const section of sections) {
      if (section.text.length > targetChars) {
        flush()
        for (const text of subdivideSection(section, targetChars))
          rawChunks.push({ text, headingPath: section.headingPath })
        continue
      }
      if (!current) {
        current = { text: section.text, headingPath: section.headingPath }
        continue
      }
      const merged = `${current.text}\n\n${section.text}`
      if (merged.length <= targetChars) {
        // merged chunk carries the most specific (last) section's heading path
        current = { text: merged, headingPath: section.headingPath }
      }
      else {
        flush()
        current = { text: section.text, headingPath: section.headingPath }
      }
    }
    flush()
  }

  return rawChunks.map((chunk, index) => ({
    index,
    text: chunk.text,
    tokenCount: approxTokens(chunk.text),
    headingPath: chunk.headingPath,
  }))
}
