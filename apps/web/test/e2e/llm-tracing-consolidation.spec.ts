import type { CompletionRequest, LLMProvider } from '../../server/lib/ai/types'
import type { ConsolidationJudge } from '../../server/lib/consolidation/types'
import { givenVerifiedUser } from '@base/testing/auth'
import { test } from '@base/testing/test'
import { describe, expect } from 'vitest'
import { halfvecLiteral } from '../../server/lib/agent/vector'
import { runConsolidation } from '../../server/lib/consolidation/engine'
import { TracedLLMProvider } from '../../server/lib/observability/traced-provider'
import { ensureNotesGraphCatalog } from './age-catalog'

function unitVector(angleDegrees: number): number[] {
  const rad = angleDegrees * Math.PI / 180
  return Array.from({ length: 2048 }, (_, i) => {
    if (i === 0)
      return Math.cos(rad)
    if (i === 1)
      return Math.sin(rad)
    return 0
  })
}

function tracedStubJudge(trx: any): { judge: ConsolidationJudge, requests: CompletionRequest[], traceOptions: any[] } {
  const requests: CompletionRequest[] = []
  const traceOptions: any[] = []

  const stubLLM: LLMProvider = {
    async complete(request) {
      requests.push(request)
      return {
        message: {
          role: 'assistant',
          content: JSON.stringify({ merges: [], prunes: [], rewrites: [] }),
        },
        usage: { promptTokens: 10, completionTokens: 5, cost: 0.0001 },
      }
    },
  }

  const tracedLLM = new TracedLLMProvider(stubLLM, {
    db: trx,
    provider: 'openrouter',
    model: 'openrouter/test-consolidation',
    llmUseCase: 'consolidation',
  })

  const judge: ConsolidationJudge = async (request, trace) => {
    traceOptions.push(trace)
    // The consolidation judge JSON schema expects merges/prunes/rewrites.
    const result = await tracedLLM.complete({
      messages: [{ role: 'user', content: 'judge' }],
      responseFormat: {
        type: 'json_schema',
        jsonSchema: { name: 'consolidation_judge', schema: { type: 'object' }, strict: true },
      },
    }, trace)

    const content = result.message.content
    if (!content)
      throw new Error('no content')

    return JSON.parse(content)
  }

  return { judge, requests, traceOptions }
}

describe('llm tracing: consolidation', () => {
  test('creates one trace per consolidation run with one generation per judge batch', async ({ server, trx }) => {
    const { workspace, cookies } = await givenVerifiedUser()
    await ensureNotesGraphCatalog(trx)

    const syncedFolder = await trx
      .insertInto('synced_folders')
      .values({ workspace_id: workspace.id, path: '/tmp/notes' })
      .returning('id')
      .executeTakeFirstOrThrow()

    const note = await trx
      .insertInto('notes')
      .values({
        workspace_id: workspace.id,
        synced_folder_id: syncedFolder.id,
        path: '/note.md',
        title: 'Note',
        content: 'content',
        content_hash: 'hash-note',
        status: 'ingested',
      })
      .returning('id')
      .executeTakeFirstOrThrow()

    await trx
      .insertInto('chunks')
      .values({ workspace_id: workspace.id, note_id: note.id, seq: 0, text: 'chunk' })
      .execute()

    // Create enough concepts to force two merge batches.
    for (let i = 0; i < 25; i++) {
      await trx
        .insertInto('concepts')
        .values({
          workspace_id: workspace.id,
          name: `Concept ${i}`,
          name_normalized: `concept ${i}`,
          description: `description ${i}`,
          embedding: halfvecLiteral(unitVector(0)),
        })
        .execute()
    }

    const { judge, traceOptions } = tracedStubJudge(trx)
    const result = await runConsolidation(trx, workspace.id, 'full', { judge })

    expect(result.status).toBe('completed')

    const trace = await trx
      .selectFrom('llm_traces')
      .selectAll()
      .where('owner_type', '=', 'consolidation_runs')
      .where('owner_id', '=', result.runId)
      .executeTakeFirstOrThrow()

    expect(trace.workspace_id).toBe(workspace.id)
    expect(trace.kind).toBe('consolidation')
    expect(trace.status).toBe('completed')

    const generations = await trx
      .selectFrom('llm_generations')
      .selectAll()
      .where('trace_id', '=', trace.id)
      .orderBy('seq', 'asc')
      .execute()

    expect(generations.length).toBeGreaterThanOrEqual(1)
    for (let i = 0; i < generations.length; i++) {
      expect(generations[i]!.seq).toBe(i)
      expect(generations[i]!.llm_use_case).toBe('consolidation')
      expect(generations[i]!.workspace_id).toBe(workspace.id)
    }

    expect(traceOptions.length).toBe(generations.length)

    // API usage is rolled up from generations in the same shape as before.
    const res = await server(`/api/consolidation/runs/${result.runId}`, { headers: { cookie: cookies } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.run.usage).toEqual({
      promptTokens: generations.length * 10,
      completionTokens: generations.length * 5,
      totalTokens: generations.length * 15,
    })
  })

  test('marks the consolidation trace failed when the judge errors', async ({ trx }) => {
    const { workspace } = await givenVerifiedUser()
    await ensureNotesGraphCatalog(trx)

    const syncedFolder = await trx
      .insertInto('synced_folders')
      .values({ workspace_id: workspace.id, path: '/tmp/notes' })
      .returning('id')
      .executeTakeFirstOrThrow()

    const note = await trx
      .insertInto('notes')
      .values({
        workspace_id: workspace.id,
        synced_folder_id: syncedFolder.id,
        path: '/note.md',
        title: 'Note',
        content: 'content',
        content_hash: 'hash-note',
        status: 'ingested',
      })
      .returning('id')
      .executeTakeFirstOrThrow()

    await trx
      .insertInto('chunks')
      .values({ workspace_id: workspace.id, note_id: note.id, seq: 0, text: 'chunk' })
      .execute()

    // Create a merge candidate so the failing judge is invoked.
    for (let i = 0; i < 2; i++) {
      await trx
        .insertInto('concepts')
        .values({
          workspace_id: workspace.id,
          name: `Failing Concept ${i}`,
          name_normalized: `failing concept ${i}`,
          description: `description ${i}`,
          embedding: halfvecLiteral(unitVector(0)),
        })
        .execute()
    }

    const failingJudge: ConsolidationJudge = async () => {
      throw new Error('consolidation judge failed')
    }

    await expect(
      runConsolidation(trx, workspace.id, 'full', { judge: failingJudge }),
    ).rejects.toThrow('consolidation judge failed')

    const trace = await trx
      .selectFrom('llm_traces')
      .selectAll()
      .where('owner_type', '=', 'consolidation_runs')
      .executeTakeFirstOrThrow()

    expect(trace.kind).toBe('consolidation')
    expect(trace.status).toBe('failed')
    expect(trace.error).toContain('consolidation judge failed')
  })
})
