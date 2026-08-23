import { test } from '@base/testing/test'
import { describe, expect } from 'vitest'
import { searchNotesTool } from '../../server/lib/agent/tools/search-notes'
import { givenChunk, givenNote, givenWorkspace, stubContext, stubEmbedding, vec } from './agent-stubs'

describe('search_notes hybrid', () => {
  test('an exact rare term ranks the containing note first even when semantically distant', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'hybrid-exact')
    const noteA = await givenNote(trx, workspaceId, '/zephyr.md', 'zephyr')
    const noteB = await givenNote(trx, workspaceId, '/pasta.md', 'pasta')

    // noteA contains the rare term but its embedding is orthogonal to the query;
    // noteB is semantically close but does not contain the term.
    await givenChunk(trx, workspaceId, noteA.id, 0, 'the zephyr protocol handles retries', vec(0, 1))
    await givenChunk(trx, workspaceId, noteB.id, 0, 'cooking pasta recipes', vec(1, 0))

    const result = await searchNotesTool.execute(
      { query: 'zephyr', limit: 5 },
      stubContext(trx, workspaceId, stubEmbedding(vec(1, 0))),
    )

    const notes = (result.result as any).notes
    expect(notes[0].path).toBe('/zephyr.md')
    expect(notes[0].chunks[0].text).toContain('zephyr')
  })

  test('a synonym query still works via the dense leg', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'hybrid-synonym')
    const noteA = await givenNote(trx, workspaceId, '/retry.md', 'retry')
    const noteB = await givenNote(trx, workspaceId, '/pasta.md', 'pasta')

    // noteA is semantically close to the query but shares no tokens with it.
    await givenChunk(trx, workspaceId, noteA.id, 0, 'the zephyr protocol handles retries', vec(1, 0))
    await givenChunk(trx, workspaceId, noteB.id, 0, 'cooking pasta recipes', vec(0, 1))

    const result = await searchNotesTool.execute(
      { query: 'retry mechanism', limit: 5 },
      stubContext(trx, workspaceId, stubEmbedding(vec(1, 0))),
    )

    const notes = (result.result as any).notes
    expect(notes[0].path).toBe('/retry.md')
  })

  test('on a mixed fixture the fused result beats either leg alone', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'hybrid-mixed')
    const noteA = await givenNote(trx, workspaceId, '/both.md', 'both')
    const noteB = await givenNote(trx, workspaceId, '/dense.md', 'dense')
    const noteC = await givenNote(trx, workspaceId, '/lexical.md', 'lexical')

    // A is strong in both legs; B only in dense; C only in lexical.
    await givenChunk(trx, workspaceId, noteA.id, 0, 'zephyr protocol', vec(1, 0))
    await givenChunk(trx, workspaceId, noteB.id, 0, 'cooking pasta', vec(0, 1))
    await givenChunk(trx, workspaceId, noteC.id, 0, 'zephyr is a bird', vec(0, 1))

    const result = await searchNotesTool.execute(
      { query: 'zephyr', limit: 5 },
      stubContext(trx, workspaceId, stubEmbedding(vec(1, 0))),
    )

    const notes = (result.result as any).notes
    // A (good in both legs) ranks first.
    expect(notes[0].path).toBe('/both.md')
    // C (lexical-only) outranks B (dense-only): neither leg alone achieves this.
    const paths = notes.map((n: any) => n.path)
    expect(paths.indexOf('/lexical.md')).toBeLessThan(paths.indexOf('/dense.md'))
  })

  test('each returned chunk carries a fused relevance score', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'hybrid-score')
    const noteA = await givenNote(trx, workspaceId, '/a.md', 'a')
    await givenChunk(trx, workspaceId, noteA.id, 0, 'zephyr protocol', vec(1, 0))

    const result = await searchNotesTool.execute(
      { query: 'zephyr', limit: 5 },
      stubContext(trx, workspaceId, stubEmbedding(vec(1, 0))),
    )

    const notes = (result.result as any).notes
    expect(notes).toHaveLength(1)
    for (const note of notes) {
      for (const chunk of note.chunks)
        expect(typeof chunk.score).toBe('number')
    }
  })

  test('results remain workspace-scoped', async ({ trx }) => {
    const wsA = await givenWorkspace(trx, 'hybrid-ws-a')
    const wsB = await givenWorkspace(trx, 'hybrid-ws-b')
    const noteA = await givenNote(trx, wsA, '/zephyr.md', 'zephyr')
    const noteB = await givenNote(trx, wsB, '/zephyr.md', 'zephyr')

    await givenChunk(trx, wsA, noteA.id, 0, 'zephyr protocol', vec(1, 0))
    await givenChunk(trx, wsB, noteB.id, 0, 'zephyr protocol', vec(1, 0))

    const result = await searchNotesTool.execute(
      { query: 'zephyr', limit: 5 },
      stubContext(trx, wsB, stubEmbedding(vec(1, 0))),
    )

    const notes = (result.result as any).notes
    expect(notes).toHaveLength(1)
    expect(notes[0].path).toBe('/zephyr.md')
    expect(result.notes).toEqual(['/zephyr.md'])
  })

  test('limit semantics are unchanged', async ({ trx }) => {
    const workspaceId = await givenWorkspace(trx, 'hybrid-limit')
    const noteA = await givenNote(trx, workspaceId, '/a.md', 'a')
    const noteB = await givenNote(trx, workspaceId, '/b.md', 'b')
    const noteC = await givenNote(trx, workspaceId, '/c.md', 'c')

    await givenChunk(trx, workspaceId, noteA.id, 0, 'zephyr protocol alpha', vec(1, 0))
    await givenChunk(trx, workspaceId, noteB.id, 0, 'zephyr protocol beta', vec(0.9, 0.1))
    await givenChunk(trx, workspaceId, noteC.id, 0, 'zephyr protocol gamma', vec(0.8, 0.2))

    const result = await searchNotesTool.execute(
      { query: 'zephyr', limit: 2 },
      stubContext(trx, workspaceId, stubEmbedding(vec(1, 0))),
    )

    const notes = (result.result as any).notes
    expect(notes).toHaveLength(2)
    expect(result.notes).toHaveLength(2)
  })
})
