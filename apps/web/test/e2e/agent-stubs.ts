import type { AgentContext, EmbeddingProvider } from '../../server/lib/agent/types'
import { halfvecLiteral } from '../../server/lib/agent/vector'

/** Seed a workspace and return its id. */
export async function givenWorkspace(trx: any, name: string): Promise<string> {
  const row = await trx
    .insertInto('workspaces')
    .values({ name })
    .returning('id')
    .executeTakeFirstOrThrow()
  return row.id
}

/** Seed a note; `content` defaults to `path` (matching the graph-expansion fixture). */
export async function givenNote(trx: any, workspaceId: string, path: string, content: string = path) {
  return trx
    .insertInto('notes')
    .values({
      workspace_id: workspaceId,
      path,
      title: path,
      content,
      content_hash: `hash-${path}`,
      status: 'ingested',
    })
    .returning(['id', 'path'])
    .executeTakeFirstOrThrow()
}

/** Seed a chunk with a vector embedding. */
export async function givenChunk(trx: any, workspaceId: string, noteId: string, seq: number, text: string, embedding: number[]) {
  return trx
    .insertInto('chunks')
    .values({
      workspace_id: workspaceId,
      note_id: noteId,
      seq,
      text,
      token_count: Math.ceil(text.length / 4),
      embedding: halfvecLiteral(embedding),
    })
    .returning('id')
    .executeTakeFirstOrThrow()
}

/** Seed a concept; `embedding` is optional (omitted by the graph-expansion fixture). */
export async function givenConcept(trx: any, workspaceId: string, name: string, embedding?: number[]) {
  return trx
    .insertInto('concepts')
    .values({
      workspace_id: workspaceId,
      name,
      name_normalized: name.toLowerCase(),
      description: `${name} description`,
      ...(embedding ? { embedding: halfvecLiteral(embedding) } : {}),
    })
    .returning(['id', 'name'])
    .executeTakeFirstOrThrow()
}

/** A 2048-dim vector with the first two components set; the rest zeroed. */
export function vec(a: number, b: number): number[] {
  const v = Array.from({ length: 2048 }).fill(0)
  v[0] = a
  v[1] = b
  return v
}

/** An embedding provider that returns the same vector for every input. */
export function stubEmbedding(value: number[]): EmbeddingProvider {
  return {
    async embed(texts) {
      return texts.map(() => value)
    },
  }
}

/** An agent context stubbed for tests; a no-op embedding provider when omitted. */
export function stubContext(trx: any, workspaceId: string, embedding?: EmbeddingProvider): AgentContext {
  return {
    workspaceId,
    db: trx,
    llm: { async complete() { throw new Error('llm not needed') } },
    embedding: embedding ?? { async embed() { throw new Error('embedding not needed') } },
  }
}
