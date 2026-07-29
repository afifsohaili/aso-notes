/**
 * Pure functions for the mention-gap report.
 *
 * A "gap" is a concept whose name (or a snake_case/camelCase/kebab/compact
 * variant) appears in a chunk's text, but no mention row links that chunk to
 * that concept.
 */

export interface ConceptRef {
  id: string
  name: string
  workspaceId: string
}

export interface ChunkRef {
  id: string
  noteId: string
  workspaceId: string
  text: string
  noteTitle: string
  notePath: string
}

export interface MentionRef {
  chunkId: string
  conceptId: string
}

export interface ConceptGapSummary {
  conceptId: string
  conceptName: string
  workspaceId: string
  matchingNotes: number
  mentionedNotes: number
  gap: number
}

export interface NoteConceptGap {
  noteId: string
  noteTitle: string
  notePath: string
  conceptId: string
  conceptName: string
  workspaceId: string
}

export interface MentionGapReport {
  conceptSummaries: ConceptGapSummary[]
  noteGaps: NoteConceptGap[]
}

export interface Variant {
  type: 'token' | 'phrase'
  value: string
}

/**
 * Generate searchable variants of a concept name.
 *
 * Single-word concepts become token variants (matched by whole token).
 * Multi-word concepts become phrase variants (matched as substrings):
 * lowercased, snake_case, kebab-case, camelCase, and compact.
 */
export function generateConceptVariants(name: string): Variant[] {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0)
    return []

  const lowerWords = words.map(w => w.toLowerCase())
  const compact = lowerWords.join('')

  if (words.length === 1) {
    return [{ type: 'token', value: compact }]
  }

  const camel = words.map((w, i) => {
    const lower = w.toLowerCase()
    return i === 0 ? lower : lower.charAt(0).toUpperCase() + lower.slice(1)
  }).join('')

  return [
    { type: 'phrase', value: lowerWords.join(' ') },
    { type: 'phrase', value: lowerWords.join('_') },
    { type: 'phrase', value: lowerWords.join('-') },
    { type: 'phrase', value: camel },
    { type: 'phrase', value: compact },
  ]
}

/**
 * Extract searchable tokens from a text fragment.
 *
 * Splits on non-alphanumeric characters and on camelCase boundaries, returning
 * lowercase tokens suitable for equality checks.
 */
export function extractTextTokens(text: string): string[] {
  const parts = text.split(/[^a-z0-9]+/i).filter(Boolean)
  const tokens = new Set<string>()

  for (const part of parts) {
    tokens.add(part.toLowerCase())
    const camelParts = splitCamelCase(part)
    if (camelParts.length > 1) {
      for (const piece of camelParts) {
        tokens.add(piece.toLowerCase())
      }
    }
  }

  return [...tokens]
}

function splitCamelCase(word: string): string[] {
  const matches = word.match(/[A-Z]?[a-z]+|[A-Z]+(?=[A-Z]|$)|\d+/g)
  return matches ?? [word]
}

/**
 * Return true if a chunk's text matches any variant of a concept name.
 */
export function textMatchesConcept(text: string, variants: Variant[]): boolean {
  const lowerText = text.toLowerCase()
  const tokens = extractTextTokens(text)

  for (const variant of variants) {
    if (variant.type === 'token') {
      if (tokens.includes(variant.value))
        return true
    }
    else if (lowerText.includes(variant.value)) {
      return true
    }
  }

  return false
}

/**
 * Given the raw rows for concepts, chunks, and mentions, compute the gap report.
 *
 * The result is deterministic: concept summaries are sorted by gap count desc,
 * then concept name; per-note gaps follow the same order.
 */
export function findMentionGaps(
  concepts: ConceptRef[],
  chunks: ChunkRef[],
  mentions: MentionRef[],
): MentionGapReport {
  const conceptVariants = new Map(concepts.map(c => [c.id, generateConceptVariants(c.name)]))
  const mentionKeys = new Set(mentions.map(m => `${m.conceptId}:${m.chunkId}`))

  // noteId -> conceptId -> true
  const matchingNotesByConcept = new Map<string, Set<string>>()
  // noteId -> conceptId -> true
  const mentionedNotesByConcept = new Map<string, Set<string>>()
  const noteGaps: NoteConceptGap[] = []

  for (const concept of concepts) {
    const variants = conceptVariants.get(concept.id) ?? []
    if (variants.length === 0)
      continue

    for (const chunk of chunks) {
      if (chunk.workspaceId !== concept.workspaceId)
        continue

      if (!textMatchesConcept(chunk.text, variants))
        continue

      const matchingSet = matchingNotesByConcept.get(concept.id) ?? new Set<string>()
      matchingSet.add(chunk.noteId)
      matchingNotesByConcept.set(concept.id, matchingSet)

      const hasMention = mentionKeys.has(`${concept.id}:${chunk.id}`)
      if (hasMention) {
        const mentionedSet = mentionedNotesByConcept.get(concept.id) ?? new Set<string>()
        mentionedSet.add(chunk.noteId)
        mentionedNotesByConcept.set(concept.id, mentionedSet)
      }
      else {
        noteGaps.push({
          noteId: chunk.noteId,
          noteTitle: chunk.noteTitle,
          notePath: chunk.notePath,
          conceptId: concept.id,
          conceptName: concept.name,
          workspaceId: concept.workspaceId,
        })
      }
    }
  }

  const conceptSummaries: ConceptGapSummary[] = concepts
    .map((concept) => {
      const matching = matchingNotesByConcept.get(concept.id) ?? new Set<string>()
      const mentioned = mentionedNotesByConcept.get(concept.id) ?? new Set<string>()
      return {
        conceptId: concept.id,
        conceptName: concept.name,
        workspaceId: concept.workspaceId,
        matchingNotes: matching.size,
        mentionedNotes: mentioned.size,
        gap: matching.size - mentioned.size,
      }
    })
    .filter(s => s.gap > 0)
    .sort((a, b) => {
      if (b.gap !== a.gap)
        return b.gap - a.gap
      return a.conceptName.localeCompare(b.conceptName)
    })

  const summaryOrder = new Map(conceptSummaries.map((s, i) => [s.conceptId, i]))
  noteGaps.sort((a, b) => {
    const orderA = summaryOrder.get(a.conceptId) ?? Number.POSITIVE_INFINITY
    const orderB = summaryOrder.get(b.conceptId) ?? Number.POSITIVE_INFINITY
    if (orderA !== orderB)
      return orderA - orderB
    return a.notePath.localeCompare(b.notePath)
  })

  return { conceptSummaries, noteGaps }
}
