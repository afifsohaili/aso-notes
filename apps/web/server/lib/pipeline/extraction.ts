import type { ChatMessage } from '../ai/types'
import type { GraphExtraction } from './types'

/**
 * Pure assembly + parsing for the extract-graph stage's whole-note structured
 * LLM call (plan-002-system §extract-graph). DB access lives in the stage;
 * this module is the unit-testable seam: prompt construction from already-
 * loaded inputs, and tolerant parsing of the model's JSON payload.
 */

export const EXTRACTION_SCHEMA_NAME = 'graph_extraction'

/**
 * Normalization for concept/tag dedup keys (`name_normalized`, plan §data
 * model): lowercase, collapse whitespace/punctuation runs to single spaces.
 */
export function normalizeGraphName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** JSON Schema constraining the extraction response (responseFormat json_schema). */
export const EXTRACTION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    concepts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['name', 'description'],
        additionalProperties: false,
      },
    },
    relations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
          type: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['from', 'to', 'type'],
        additionalProperties: false,
      },
    },
    mentions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          concept: { type: 'string' },
          chunkRefs: { type: 'array', items: { type: 'integer' } },
        },
        required: ['concept', 'chunkRefs'],
        additionalProperties: false,
      },
    },
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['concepts', 'relations', 'mentions', 'tags'],
  additionalProperties: false,
}

export interface ExtractionPromptInput {
  noteTitle: string
  notePath: string
  /** Merged folder-cover chain (root→leaf) when the note sits under covers. */
  coverChain?: string
  chunks: { index: number, text: string, headingPath: string[] }[]
  /** Every concept already known in the workspace — the dedup vocabulary. */
  existingConcepts: { name: string, description: string | null }[]
  /** Every tag name already used in the workspace — vocabulary hints. */
  existingTags: string[]
}

const SYSTEM_PROMPT = [
  'You are a knowledge-graph extractor for a personal notes system.',
  'Given one note (presented as enumerated chunks), extract:',
  '- concepts: the salient ideas, entities, and topics, each with a one-sentence description.',
  '- relations: typed links between extracted or existing concepts (from, to, a short free-text type).',
  '- mentions: for each concept, the indices of the chunks where it appears (chunkRefs).',
  '- tags: a small set of suggested tag names for the note.',
  'Rules:',
  '- Reuse an existing concept (exact name) whenever it matches what the note discusses; only coin new concepts for genuinely new ideas.',
  '- Prefer existing tag names when they fit; invent new ones sparingly.',
  '- Only reference chunk indices that exist.',
  '- Relations may connect any concepts, whether newly extracted or already existing.',
].join('\n')

/**
 * Build the system+user messages for the extraction call. The note is
 * presented as enumerated chunks (with heading paths) so the model can cite
 * chunk indices in mentions.
 */
export function buildExtractionMessages(input: ExtractionPromptInput): ChatMessage[] {
  const sections: string[] = []

  if (input.coverChain)
    sections.push(`## Folder context\n${input.coverChain}`)

  sections.push(`## Note\nTitle: ${input.noteTitle}\nPath: ${input.notePath}`)

  const chunkLines = input.chunks.map((chunk) => {
    const heading = chunk.headingPath.length > 0 ? ` (${chunk.headingPath.join(' > ')})` : ''
    return `[chunk ${chunk.index}]${heading}\n${chunk.text}`
  })
  sections.push(`## Chunks\n${chunkLines.join('\n\n')}`)

  const conceptLines = input.existingConcepts.length > 0
    ? input.existingConcepts.map(c => `- ${c.name}: ${c.description ?? ''}`.trimEnd()).join('\n')
    : '(no existing concepts yet)'
  sections.push(`## Existing concepts (reuse these when they match)\n${conceptLines}`)

  const tagLine = input.existingTags.length > 0
    ? input.existingTags.join(', ')
    : '(no existing tags yet)'
  sections.push(`## Existing tags (prefer these when they fit)\n${tagLine}`)

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: sections.join('\n\n') },
  ]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/**
 * Parse the model's structured output tolerantly (plan §failure model:
 * hallucinated chunk refs are dropped). Malformed entries are skipped rather
 * than failing the note; a payload that isn't valid JSON at all throws so
 * the stage (and BullMQ retry) sees a hard failure.
 */
export function parseExtraction(raw: string, chunkCount: number): GraphExtraction {
  const payload: unknown = JSON.parse(raw)
  const root = isRecord(payload) ? payload : {}

  const concepts: GraphExtraction['concepts'] = []
  if (Array.isArray(root.concepts)) {
    for (const entry of root.concepts) {
      if (!isRecord(entry))
        continue
      const name = asNonEmptyString(entry.name)
      if (!name)
        continue
      concepts.push({
        name,
        description: typeof entry.description === 'string' ? entry.description : '',
      })
    }
  }

  const relations: GraphExtraction['relations'] = []
  if (Array.isArray(root.relations)) {
    for (const entry of root.relations) {
      if (!isRecord(entry))
        continue
      const from = asNonEmptyString(entry.from)
      const to = asNonEmptyString(entry.to)
      const type = asNonEmptyString(entry.type)
      if (!from || !to || !type)
        continue
      relations.push({
        from,
        to,
        type,
        ...(typeof entry.description === 'string' ? { description: entry.description } : {}),
      })
    }
  }

  const mentions: GraphExtraction['mentions'] = []
  if (Array.isArray(root.mentions)) {
    for (const entry of root.mentions) {
      if (!isRecord(entry))
        continue
      const concept = asNonEmptyString(entry.concept)
      if (!concept || !Array.isArray(entry.chunkRefs))
        continue
      const chunkRefs = [...new Set(
        entry.chunkRefs.filter(
          (ref): ref is number =>
            typeof ref === 'number' && Number.isInteger(ref) && ref >= 0 && ref < chunkCount,
        ),
      )].sort((a, b) => a - b)
      if (chunkRefs.length === 0)
        continue
      mentions.push({ concept, chunkRefs })
    }
  }

  const tags: string[] = []
  if (Array.isArray(root.tags)) {
    for (const entry of root.tags) {
      const tag = asNonEmptyString(entry)
      if (tag)
        tags.push(tag)
    }
  }

  return { concepts, relations, mentions, tags }
}
