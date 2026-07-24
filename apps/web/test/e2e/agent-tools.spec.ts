import type { AgentContext, EmbeddingProvider } from '../../server/lib/agent/types'
import { test } from '@base/testing/test'
import { describe, expect } from 'vitest'
import { findPathsBetweenTool } from '../../server/lib/agent/tools/find-paths-between'
import { getConceptNeighborsTool } from '../../server/lib/agent/tools/get-concept-neighbors'
import { getMentionsTool } from '../../server/lib/agent/tools/get-mentions'
import { readNoteTool } from '../../server/lib/agent/tools/read-note'
import { searchConceptsTool } from '../../server/lib/agent/tools/search-concepts'
import { searchNotesTool } from '../../server/lib/agent/tools/search-notes'
import { searchSourcesTool } from '../../server/lib/agent/tools/search-sources'
import { halfvecLiteral } from '../../server/lib/agent/vector'
import { mergeConceptNode, mergeRelatesToEdge } from '../../server/lib/graph'
import { ensureNotesGraphCatalog } from './age-catalog'

async function givenWorkspace(trx: any, name: string): Promise<string> {
  const row = await trx
    .insertInto('workspaces')
    .values({ name })
    .returning('id')
    .executeTakeFirstOrThrow()
  return row.id
}

async function givenNote(trx: any, workspaceId: string, path: string, content: string) {
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

async function givenChunk(trx: any, workspaceId: string, noteId: string, seq: number, text: string, embedding: number[]) {
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

async function givenConcept(trx: any, workspaceId: string, name: string, embedding: number[]) {
  return trx
    .insertInto('concepts')
    .values({
      workspace_id: workspaceId,
      name,
      name_normalized: name.toLowerCase(),
      description: `${name} description`,
      embedding: halfvecLiteral(embedding),
    })
    .returning(['id', 'name'])
    .executeTakeFirstOrThrow()
}

function vec(a: number, b: number): number[] {
  const v = Array.from({ length: 2048 }).fill(0)
  v[0] = a
  v[1] = b
  return v
}

function stubEmbedding(value: number[]): EmbeddingProvider {
  return {
    async embed(texts) {
      return texts.map(() => value)
    },
  }
}

function stubContext(trx: any, workspaceId: string, embedding?: EmbeddingProvider): AgentContext {
  return {
    workspaceId,
    db: trx,
    llm: { async complete() { throw new Error('llm not needed') } },
    embedding: embedding ?? { async embed() { throw new Error('embedding not needed') } },
  }
}

describe('agent tools', () => {
  describe('read_note', () => {
    test('returns note content and cites the note path', async ({ trx }) => {
      const workspaceId = await givenWorkspace(trx, 'read-note')
      const note = await givenNote(trx, workspaceId, '/projects/ideas.md', '# Ideas\n\nBuild agent.')

      const result = await readNoteTool.execute({ path: '/projects/ideas.md' }, stubContext(trx, workspaceId))

      expect(result.result).toEqual({
        note: {
          path: note.path,
          title: note.path,
          content: '# Ideas\n\nBuild agent.',
        },
      })
      expect(result.notes).toEqual(['/projects/ideas.md'])
    })

    test('returns notFound for a missing path', async ({ trx }) => {
      const workspaceId = await givenWorkspace(trx, 'read-note-missing')
      const result = await readNoteTool.execute({ path: '/ghost.md' }, stubContext(trx, workspaceId))

      expect(result.result).toEqual({ notFound: true, path: '/ghost.md' })
      expect(result.notes).toEqual([])
    })

    test('rejects empty path', async ({ trx }) => {
      const workspaceId = await givenWorkspace(trx, 'read-note-empty')
      const result = await readNoteTool.execute({ path: '  ' }, stubContext(trx, workspaceId))

      expect(result.result).toEqual({ error: 'path is required' })
      expect(result.notes).toEqual([])
    })

    test('scopes to workspace', async ({ trx }) => {
      const wsA = await givenWorkspace(trx, 'ws-a')
      const wsB = await givenWorkspace(trx, 'ws-b')
      await givenNote(trx, wsA, '/shared.md', 'A')
      await givenNote(trx, wsB, '/shared.md', 'B')

      const result = await readNoteTool.execute({ path: '/shared.md' }, stubContext(trx, wsB))

      expect((result.result as any).note.content).toBe('B')
    })
  })

  describe('search_notes', () => {
    test('returns chunks grouped by note ordered by vector similarity', async ({ trx }) => {
      const workspaceId = await givenWorkspace(trx, 'search-notes')
      const noteA = await givenNote(trx, workspaceId, '/alpha.md', 'alpha')
      const noteB = await givenNote(trx, workspaceId, '/beta.md', 'beta')

      await givenChunk(trx, workspaceId, noteA.id, 0, 'alpha chunk', vec(1, 0))
      await givenChunk(trx, workspaceId, noteB.id, 0, 'beta chunk', vec(0, 1))

      const result = await searchNotesTool.execute(
        { query: 'alpha query', limit: 5 },
        stubContext(trx, workspaceId, stubEmbedding(vec(1, 0))),
      )

      const notes = (result.result as any).notes
      expect(notes).toHaveLength(2)
      expect(notes[0].path).toBe('/alpha.md')
      expect(notes[0].chunks[0].text).toBe('alpha chunk')
      expect(notes[1].path).toBe('/beta.md')
      expect(result.notes).toEqual(['/alpha.md', '/beta.md'])
    })

    test('returns error for empty query', async ({ trx }) => {
      const workspaceId = await givenWorkspace(trx, 'search-notes-empty')
      const result = await searchNotesTool.execute({ query: '  ' }, stubContext(trx, workspaceId, stubEmbedding(vec(0, 0))))
      expect(result.result).toEqual({ error: 'query is required' })
    })
  })

  describe('search_concepts', () => {
    test('returns concepts ordered by embedding similarity', async ({ trx }) => {
      const workspaceId = await givenWorkspace(trx, 'search-concepts')
      const conceptA = await givenConcept(trx, workspaceId, 'Alpha Concept', vec(1, 0))
      await givenConcept(trx, workspaceId, 'Beta Concept', vec(0, 1))

      const result = await searchConceptsTool.execute(
        { query: 'alpha', limit: 5 },
        stubContext(trx, workspaceId, stubEmbedding(vec(1, 0))),
      )

      const concepts = (result.result as any).concepts
      expect(concepts[0].id).toBe(conceptA.id)
      expect(concepts[0].name).toBe('Alpha Concept')
      expect(concepts[0].distance).toBeLessThan(concepts[1].distance)
      expect(result.notes).toEqual([])
    })

    test('scopes concepts to workspace', async ({ trx }) => {
      const wsA = await givenWorkspace(trx, 'ws-a-concepts')
      const wsB = await givenWorkspace(trx, 'ws-b-concepts')
      await givenConcept(trx, wsA, 'Shared', vec(1, 0))
      const conceptB = await givenConcept(trx, wsB, 'Shared', vec(1, 0))

      const result = await searchConceptsTool.execute(
        { query: 'shared' },
        stubContext(trx, wsB, stubEmbedding(vec(1, 0))),
      )

      expect((result.result as any).concepts).toHaveLength(1)
      expect((result.result as any).concepts[0].id).toBe(conceptB.id)
    })
  })

  describe('get_concept_neighbors', () => {
    test('returns related concepts ordered by graph distance', async ({ trx }) => {
      const workspaceId = await givenWorkspace(trx, 'neighbors')
      await ensureNotesGraphCatalog(trx)

      const a = await givenConcept(trx, workspaceId, 'A', vec(0, 0))
      const b = await givenConcept(trx, workspaceId, 'B', vec(0, 0))
      const c = await givenConcept(trx, workspaceId, 'C', vec(0, 0))

      await mergeConceptNode(trx, { id: a.id, workspaceId, name: 'A' })
      await mergeConceptNode(trx, { id: b.id, workspaceId, name: 'B' })
      await mergeConceptNode(trx, { id: c.id, workspaceId, name: 'C' })
      await mergeRelatesToEdge(trx, { fromId: a.id, toId: b.id, type: 'related', workspaceId })
      await mergeRelatesToEdge(trx, { fromId: b.id, toId: c.id, type: 'related', workspaceId })

      const result = await getConceptNeighborsTool.execute({ concept_id: a.id, depth: 2 }, stubContext(trx, workspaceId))
      const names = (result.result as any).neighbors.map((n: any) => n.name)
      expect(names).toEqual(['B', 'C'])
    })
  })

  describe('get_mentions', () => {
    test('returns chunks grouped by note for a concept', async ({ trx }) => {
      const workspaceId = await givenWorkspace(trx, 'mentions')
      const concept = await givenConcept(trx, workspaceId, 'Focus', vec(0, 0))
      const note = await givenNote(trx, workspaceId, '/focus.md', 'focus note')
      const chunk = await givenChunk(trx, workspaceId, note.id, 0, 'focus chunk', vec(0, 0))

      await trx
        .insertInto('mentions')
        .values({ workspace_id: workspaceId, chunk_id: chunk.id, concept_id: concept.id })
        .execute()

      const result = await getMentionsTool.execute({ concept_id: concept.id }, stubContext(trx, workspaceId))
      expect((result.result as any).notes).toHaveLength(1)
      expect((result.result as any).notes[0].path).toBe('/focus.md')
      expect((result.result as any).notes[0].chunks[0].text).toBe('focus chunk')
      expect(result.notes).toEqual(['/focus.md'])
    })
  })

  describe('find_paths_between', () => {
    test('returns graph paths between two concepts', async ({ trx }) => {
      const workspaceId = await givenWorkspace(trx, 'paths')
      await ensureNotesGraphCatalog(trx)

      const a = await givenConcept(trx, workspaceId, 'Start', vec(0, 0))
      const b = await givenConcept(trx, workspaceId, 'Bridge', vec(0, 0))
      const c = await givenConcept(trx, workspaceId, 'End', vec(0, 0))

      await mergeConceptNode(trx, { id: a.id, workspaceId, name: 'Start' })
      await mergeConceptNode(trx, { id: b.id, workspaceId, name: 'Bridge' })
      await mergeConceptNode(trx, { id: c.id, workspaceId, name: 'End' })
      await mergeRelatesToEdge(trx, { fromId: a.id, toId: b.id, type: 'links', workspaceId })
      await mergeRelatesToEdge(trx, { fromId: b.id, toId: c.id, type: 'links', workspaceId })

      const result = await findPathsBetweenTool.execute(
        { start_concept_id: a.id, end_concept_id: c.id, max_depth: 3 },
        stubContext(trx, workspaceId),
      )

      expect((result.result as any).count).toBe(1)
      expect((result.result as any).paths[0].length).toBe(2)
    })
  })

  describe('search_sources', () => {
    test('returns sources matching URL or title and cites their notes', async ({ trx }) => {
      const workspaceId = await givenWorkspace(trx, 'sources')
      const note = await givenNote(trx, workspaceId, '/src.md', 'source note')

      await trx
        .insertInto('sources')
        .values({
          workspace_id: workspaceId,
          note_id: note.id,
          url: 'https://example.com/article',
          url_normalized: 'example.com/article',
          title: 'Reference Article',
          type: 'web',
        })
        .execute()

      const result = await searchSourcesTool.execute({ query: 'Reference' }, stubContext(trx, workspaceId))
      expect((result.result as any).sources).toHaveLength(1)
      expect((result.result as any).sources[0].note_path).toBe('/src.md')
      expect(result.notes).toEqual(['/src.md'])
    })

    test('filters by source type', async ({ trx }) => {
      const workspaceId = await givenWorkspace(trx, 'sources-type')
      const note = await givenNote(trx, workspaceId, '/src2.md', 'note')

      await trx
        .insertInto('sources')
        .values({
          workspace_id: workspaceId,
          note_id: note.id,
          url: 'https://youtube.com/watch?v=abc',
          url_normalized: 'youtube.com/watch?v=abc',
          title: 'Video',
          type: 'youtube',
        })
        .execute()

      const result = await searchSourcesTool.execute({ query: 'youtube', type: 'youtube' }, stubContext(trx, workspaceId))
      expect((result.result as any).sources).toHaveLength(1)
      expect((result.result as any).sources[0].type).toBe('youtube')
    })
  })
})
