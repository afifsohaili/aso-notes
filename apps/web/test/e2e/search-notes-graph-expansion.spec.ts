import { test } from '@base/testing/test'
import { describe, expect } from 'vitest'
import { searchNotesTool } from '../../server/lib/agent/tools/search-notes'
import { halfvecLiteral } from '../../server/lib/agent/vector'
import { mergeConceptNode, mergeRelatesToEdge } from '../../server/lib/graph'
import { ensureNotesGraphCatalog } from './age-catalog'
import { givenChunk, givenConcept, givenNote, givenWorkspace, stubContext, stubEmbedding, vec } from './agent-stubs'

async function givenMention(trx: any, workspaceId: string, chunkId: string, conceptId: string) {
  await trx
    .insertInto('mentions')
    .values({ workspace_id: workspaceId, chunk_id: chunkId, concept_id: conceptId })
    .execute()
}

/**
 * Seed the canonical expansion fixture:
 *  - Note A → chunkA (strong direct hit, embedding vec(1,0)) mentions Concept X
 *  - AGE Relation X -[type]-> Y (RELATES_TO edge, workspace-scoped)
 *  - Note B → chunkB (embedding vec(0,1), weak for the query) mentions Concept Y
 * chunkA ranks top for the query; chunkB ranks below it, so with `limit: 1`
 * only Note A is a direct hit and Note B can only surface via expansion.
 */
async function seedExpansionFixture(trx: any, workspaceId: string, opts: { relationType?: string, prefix?: string } = {}) {
  await ensureNotesGraphCatalog(trx)
  const type = opts.relationType ?? 'supports'
  const prefix = opts.prefix ?? ''

  const x = await givenConcept(trx, workspaceId, 'Concept X')
  const y = await givenConcept(trx, workspaceId, 'Concept Y')

  const noteA = await givenNote(trx, workspaceId, `${prefix}/note-a.md`)
  const noteB = await givenNote(trx, workspaceId, `${prefix}/note-b.md`)
  const chunkA = await givenChunk(trx, workspaceId, noteA.id, 0, 'the zephyr protocol handles retries', vec(1, 0))
  const chunkB = await givenChunk(trx, workspaceId, noteB.id, 0, 'cooking pasta recipes with anchovies', vec(0, 1))

  await givenMention(trx, workspaceId, chunkA.id, x.id)
  await givenMention(trx, workspaceId, chunkB.id, y.id)

  await mergeConceptNode(trx, { id: x.id, workspaceId, name: x.name })
  await mergeConceptNode(trx, { id: y.id, workspaceId, name: y.name })
  await mergeRelatesToEdge(trx, { fromId: x.id, toId: y.id, type, workspaceId })

  return { x, y, noteA, noteB, chunkA, chunkB }
}

describe('search_notes graph expansion', () => {
  test('surfaces a related note with its provenance chain', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'expansion-basic')
    await seedExpansionFixture(trx, workspaceId)

    // limit:1 keeps only the top-ranked Note A as a direct hit; Note B is
    // reachable only through the one-hop Relation.
    const result = await searchNotesTool.execute(
      { query: 'zephyr', limit: 1, relatedLimit: 3 },
      stubContext(trx, workspaceId, stubEmbedding(vec(1, 0))),
    )

    const payload = result.result as any
    expect(payload.notes.map((n: any) => n.path)).toEqual(['/note-a.md'])

    const related = payload.related
    expect(related).toHaveLength(1)
    expect(related[0].path).toBe('/note-b.md')
    expect(related[0].title).toBe('/note-b.md')
    expect(related[0].text).toBe('cooking pasta recipes with anchovies')
    expect(related[0].provenance).toEqual({
      matchedConcept: 'Concept X',
      neighborConcept: 'Concept Y',
      relationType: 'supports',
      // The direct-hit Chunk (Note A) whose Mention of Concept X led here.
      matchedChunk: { path: '/note-a.md', seq: 0 },
    })
    // The related note is also cited so the Agent can reference it.
    expect(result.notes).toContain('/note-b.md')
  })

  test('no relations produces an empty related section', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'graph-norel')
    await ensureNotesGraphCatalog(trx)

    const x = await givenConcept(trx, workspaceId, 'Concept X')
    const noteA = await givenNote(trx, workspaceId, '/note-a.md')
    const chunkA = await givenChunk(trx, workspaceId, noteA.id, 0, 'the zephyr protocol handles retries', vec(1, 0))
    await givenMention(trx, workspaceId, chunkA.id, x.id)
    await mergeConceptNode(trx, { id: x.id, workspaceId, name: x.name })

    const result = await searchNotesTool.execute(
      { query: 'zephyr', limit: 1, relatedLimit: 3 },
      stubContext(trx, workspaceId, stubEmbedding(vec(1, 0))),
    )

    expect((result.result as any).related).toEqual([])
    expect(result.notes).toEqual(['/note-a.md'])
  })

  test('relatedLimit caps the number of related entries', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'graph-cap')
    await ensureNotesGraphCatalog(trx)

    const x = await givenConcept(trx, workspaceId, 'Concept X')
    const noteA = await givenNote(trx, workspaceId, '/note-a.md')
    const chunkA = await givenChunk(trx, workspaceId, noteA.id, 0, 'the zephyr protocol handles retries', vec(1, 0))
    await givenMention(trx, workspaceId, chunkA.id, x.id)
    await mergeConceptNode(trx, { id: x.id, workspaceId, name: x.name })

    // Three neighbors, each on its own note, all weak for the query.
    for (let i = 0; i < 3; i++) {
      const neighbor = await givenConcept(trx, workspaceId, `Neighbor ${i}`)
      const note = await givenNote(trx, workspaceId, `/neighbor-${i}.md`)
      const chunk = await givenChunk(trx, workspaceId, note.id, 0, `neighbor chunk ${i}`, vec(0, 1))
      await givenMention(trx, workspaceId, chunk.id, neighbor.id)
      await mergeConceptNode(trx, { id: neighbor.id, workspaceId, name: neighbor.name })
      await mergeRelatesToEdge(trx, { fromId: x.id, toId: neighbor.id, type: 'supports', workspaceId })
    }

    const result = await searchNotesTool.execute(
      { query: 'zephyr', limit: 1, relatedLimit: 2 },
      stubContext(trx, workspaceId, stubEmbedding(vec(1, 0))),
    )

    expect((result.result as any).related).toHaveLength(2)
  })

  test('relatedLimit=0 is clamped up to the minimum of 1', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'graph-clamp-min')
    await seedExpansionFixture(trx, workspaceId)

    const result = await searchNotesTool.execute(
      { query: 'zephyr', limit: 1, relatedLimit: 0 },
      stubContext(trx, workspaceId, stubEmbedding(vec(1, 0))),
    )

    const payload = result.result as any
    // 0 is clamped to 1, so expansion still runs and surfaces the neighbor.
    expect(payload.related).toHaveLength(1)
    expect(payload.related[0].path).toBe('/note-b.md')
    expect(result.notes).toContain('/note-b.md')
  })

  test('relatedLimit defaults to 3 when omitted', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'graph-default')
    await seedExpansionFixture(trx, workspaceId)

    const result = await searchNotesTool.execute(
      { query: 'zephyr', limit: 1 },
      stubContext(trx, workspaceId, stubEmbedding(vec(1, 0))),
    )

    expect((result.result as any).related).toHaveLength(1)
  })

  test('relatedLimit is clamped to the max of 10', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'graph-clamp')
    await seedExpansionFixture(trx, workspaceId)

    const result = await searchNotesTool.execute(
      { query: 'zephyr', limit: 1, relatedLimit: 999 },
      stubContext(trx, workspaceId, stubEmbedding(vec(1, 0))),
    )

    expect((result.result as any).related).toHaveLength(1)
  })

  test('a chunk that is already a direct hit is never duplicated in related', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'graph-dedupe')
    const { noteB } = await seedExpansionFixture(trx, workspaceId)

    // Make Note B's chunk the strongest hit so it lands in the direct result
    // at limit:2 (alongside Note A).
    await trx
      .updateTable('chunks')
      .where('note_id', '=', noteB.id)
      .set({ embedding: halfvecLiteral(vec(1, 0)) })
      .execute()

    const result = await searchNotesTool.execute(
      { query: 'zephyr', limit: 2, relatedLimit: 3 },
      stubContext(trx, workspaceId, stubEmbedding(vec(1, 0))),
    )

    const payload = result.result as any
    const directPaths = payload.notes.map((n: any) => n.path)
    expect(directPaths).toContain('/note-b.md')

    // Note B's Note is already a direct hit, so its chunk must not repeat in related.
    const relatedPaths = payload.related.map((r: any) => r.path)
    expect(relatedPaths).not.toContain('/note-b.md')
  })

  test('expands a Relation stored in the reverse direction (Y→X only)', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'graph-reverse')
    await ensureNotesGraphCatalog(trx)

    const x = await givenConcept(trx, workspaceId, 'Concept X')
    const y = await givenConcept(trx, workspaceId, 'Concept Y')

    const noteA = await givenNote(trx, workspaceId, '/note-a.md')
    const noteB = await givenNote(trx, workspaceId, '/note-b.md')
    const chunkA = await givenChunk(trx, workspaceId, noteA.id, 0, 'the zephyr protocol handles retries', vec(1, 0))
    const chunkB = await givenChunk(trx, workspaceId, noteB.id, 0, 'cooking pasta recipes with anchovies', vec(0, 1))

    await givenMention(trx, workspaceId, chunkA.id, x.id)
    await givenMention(trx, workspaceId, chunkB.id, y.id)

    await mergeConceptNode(trx, { id: x.id, workspaceId, name: x.name })
    await mergeConceptNode(trx, { id: y.id, workspaceId, name: y.name })
    // The Relation is stored ONLY as Y→X, the reverse of the natural expansion
    // direction (X is the matched Concept). It must still be traversable.
    await mergeRelatesToEdge(trx, { fromId: y.id, toId: x.id, type: 'contradicts', workspaceId })

    const result = await searchNotesTool.execute(
      { query: 'zephyr', limit: 1, relatedLimit: 3 },
      stubContext(trx, workspaceId, stubEmbedding(vec(1, 0))),
    )

    const payload = result.result as any
    expect(payload.notes.map((n: any) => n.path)).toEqual(['/note-a.md'])

    const related = payload.related
    expect(related).toHaveLength(1)
    expect(related[0].path).toBe('/note-b.md')
    expect(related[0].text).toBe('cooking pasta recipes with anchovies')
    // Provenance still reports the Relation type and both Concept names.
    expect(related[0].provenance).toEqual({
      matchedConcept: 'Concept X',
      neighborConcept: 'Concept Y',
      relationType: 'contradicts',
      matchedChunk: { path: '/note-a.md', seq: 0 },
    })
  })

  test('provenance identifies the correct source Chunk when multiple direct hits mention the matched Concept', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'graph-multi-source')
    await ensureNotesGraphCatalog(trx)

    const x = await givenConcept(trx, workspaceId, 'Concept X')
    const y = await givenConcept(trx, workspaceId, 'Concept Y')

    // Two direct-hit Notes (A and C) both mention Concept X; Note B mentions
    // Concept Y and is reachable only via expansion.
    const noteA = await givenNote(trx, workspaceId, '/note-a.md')
    const noteB = await givenNote(trx, workspaceId, '/note-b.md')
    const noteC = await givenNote(trx, workspaceId, '/note-c.md')
    const chunkA = await givenChunk(trx, workspaceId, noteA.id, 0, 'the zephyr protocol handles retries', vec(1, 0))
    const chunkB = await givenChunk(trx, workspaceId, noteB.id, 0, 'cooking pasta recipes with anchovies', vec(0, 1))
    const chunkC = await givenChunk(trx, workspaceId, noteC.id, 1, 'zephyr also handles backpressure', vec(1, 0))

    await givenMention(trx, workspaceId, chunkA.id, x.id)
    await givenMention(trx, workspaceId, chunkC.id, x.id)
    await givenMention(trx, workspaceId, chunkB.id, y.id)

    await mergeConceptNode(trx, { id: x.id, workspaceId, name: x.name })
    await mergeConceptNode(trx, { id: y.id, workspaceId, name: y.name })
    await mergeRelatesToEdge(trx, { fromId: x.id, toId: y.id, type: 'supports', workspaceId })

    // limit:2 admits both Note A and Note C as direct hits; Note B only via expansion.
    const result = await searchNotesTool.execute(
      { query: 'zephyr', limit: 2, relatedLimit: 3 },
      stubContext(trx, workspaceId, stubEmbedding(vec(1, 0))),
    )

    const payload = result.result as any
    const directPaths = payload.notes.map((n: any) => n.path)
    expect(directPaths).toEqual(expect.arrayContaining(['/note-a.md', '/note-c.md']))

    const related = payload.related
    expect(related).toHaveLength(1)
    expect(related[0].path).toBe('/note-b.md')
    // The matched Chunk is the first direct hit (by note path, then seq) that
    // mentions Concept X — Note A's chunk, not Note C's.
    expect(related[0].provenance).toEqual({
      matchedConcept: 'Concept X',
      neighborConcept: 'Concept Y',
      relationType: 'supports',
      matchedChunk: { path: '/note-a.md', seq: 0 },
    })
  })

  test('graph expansion does not cross workspace boundaries', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'graph-ws-a')
    const other = await givenWorkspace(trx, 'graph-ws-b')
    await seedExpansionFixture(trx, workspaceId)

    // Seed an analogous X→Y relation + Note B in ANOTHER workspace.
    await seedExpansionFixture(trx, other, { prefix: '/other' })

    const result = await searchNotesTool.execute(
      { query: 'zephyr', limit: 1, relatedLimit: 3 },
      stubContext(trx, workspaceId, stubEmbedding(vec(1, 0))),
    )

    const payload = result.result as any
    expect(payload.related).toHaveLength(1)
    // Only the current workspace's neighbor expands; the other's must not leak.
    expect(payload.related[0].path).toBe('/note-b.md')
    expect(result.notes).not.toContain('/other/note-b.md')
  })
})
