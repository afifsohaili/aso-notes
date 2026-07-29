import type { ExistingConcept, ExistingTopic, Vocabulary, VocabularyStrategy } from './types'

export interface TopKOptions {
  /** Number of top concepts to inject. Default 50. */
  k?: number
}

function parseHalfvec(raw: string | null): number[] | null {
  if (!raw)
    return null
  const match = raw.match(/^\[(.*)\]$/)
  if (!match)
    return null
  return match[1]!
    .split(',')
    .map(s => Number.parseFloat(s.trim()))
    .filter(n => !Number.isNaN(n))
}

function magnitude(vec: number[]): number {
  return Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0))
}

function cosineSimilarity(a: number[], b: number[]): number {
  const magA = magnitude(a)
  const magB = magnitude(b)
  if (magA === 0 || magB === 0)
    return 0
  let dot = 0
  for (let i = 0; i < a.length; i++)
    dot += a[i]! * b[i]!
  return dot / (magA * magB)
}

function centroid(vectors: number[][]): number[] {
  if (vectors.length === 0)
    return []
  const dim = vectors[0]!.length
  const sum = Array.from({ length: dim }).fill(0) as number[]
  for (const vec of vectors) {
    for (let i = 0; i < dim; i++)
      sum[i] += vec[i]!
  }
  return sum.map(v => v / vectors.length)
}

/**
 * Top-K vocabulary strategy: inject the full topic list, full tag list, and the
 * top-K existing concepts by embedding cosine similarity to the note's chunk
 * embedding centroid. Concepts without embeddings are excluded from ranking.
 */
export function topKStrategy(options: TopKOptions = {}): VocabularyStrategy {
  const k = options.k ?? 50

  return {
    id: 'top-k',

    async loadVocabulary(db, workspaceId, embeddedChunks): Promise<Vocabulary> {
      const [conceptRows, tags, topics] = await Promise.all([
        db
          .selectFrom('concepts')
          .select(['id', 'name', 'description', 'embedding'])
          .where('workspace_id', '=', workspaceId)
          .execute(),
        db
          .selectFrom('tags')
          .select('name')
          .where('workspace_id', '=', workspaceId)
          .orderBy('name')
          .execute(),
        db
          .selectFrom('topics')
          .select(['id', 'name', 'description'])
          .where('workspace_id', '=', workspaceId)
          .orderBy('name')
          .execute() as Promise<ExistingTopic[]>,
      ])

      const ranked = conceptRows
        .map((row): ExistingConcept & { embedding: number[], similarity: number } | null => {
          const parsed = parseHalfvec(row.embedding)
          if (!parsed || parsed.length === 0)
            return null
          const noteCentroid = centroid(embeddedChunks.map(c => c.embedding))
          if (noteCentroid.length === 0)
            return null
          return {
            id: row.id,
            name: row.name,
            description: row.description,
            embedding: parsed,
            similarity: cosineSimilarity(parsed, noteCentroid),
          }
        })
        .filter((c): c is NonNullable<typeof c> => c !== null)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, k)
        .map(({ id, name, description }) => ({ id, name, description }))

      return {
        concepts: ranked,
        tags: tags.map(t => t.name),
        topics,
      }
    },

    mergeOnStore: false,
  }
}
