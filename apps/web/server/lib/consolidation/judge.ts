import type { DB } from '@monorepo/shared'
import type { Kysely, Transaction } from 'kysely'
import type { EmbeddingProvider, LLMProvider } from '../ai/types'
import type { ConsolidationJudge, ConsolidationJudgeRequest, ConsolidationJudgeResponse, MergeCandidate, PruneCandidate } from './types'
import process from 'node:process'
import { createEmbeddingProvider, resolveLLMProvider } from '../ai/registry'
import { resolveConsolidationProviderSettings, resolveEmbeddingProviderSettings } from '../settings'

export type ConsolidationDb = Kysely<DB> | Transaction<DB>

interface JudgeOptions {
  llmProvider: LLMProvider
  embeddingProvider?: EmbeddingProvider
}

const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    merges: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          pair_id: { type: 'string' },
          merge: { type: 'boolean' },
          survivor_id: { type: 'string' },
          merged_description: { type: ['string', 'null'] },
          reason: { type: 'string' },
        },
        required: ['pair_id', 'merge', 'survivor_id', 'merged_description', 'reason'],
      },
    },
    prunes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          prune: { type: 'boolean' },
          reason: { type: 'string' },
        },
        required: ['id', 'prune', 'reason'],
      },
    },
  },
  required: ['merges', 'prunes'],
} as const

const JUDGE_SCHEMA_NAME = 'consolidation_judge'

export function createDefaultJudge(options: JudgeOptions): ConsolidationJudge {
  return async (request: ConsolidationJudgeRequest): Promise<ConsolidationJudgeResponse> => {
    if (request.mergePairs.length === 0 && request.pruneCandidates.length === 0)
      return { merges: [], prunes: [] }

    const messages = buildJudgeMessages(request)

    const result = await options.llmProvider.complete({
      messages,
      responseFormat: {
        type: 'json_schema',
        jsonSchema: { name: JUDGE_SCHEMA_NAME, schema: JUDGE_SCHEMA, strict: true },
      },
    })

    const content = result.message.content
    if (!content)
      throw new Error('consolidation judge returned no content')

    const parsed = JSON.parse(content) as {
      merges: { pair_id: string, merge: boolean, survivor_id: string, merged_description: string | null, reason: string }[]
      prunes: { id: string, prune: boolean, reason: string }[]
    }

    return {
      merges: parsed.merges.map(m => ({
        pairId: m.pair_id,
        merge: m.merge,
        survivorId: m.survivor_id,
        mergedDescription: m.merged_description,
        reason: m.reason,
      })),
      prunes: parsed.prunes.map(p => ({
        id: p.id,
        prune: p.prune,
        reason: p.reason,
      })),
    }
  }
}

export async function resolveJudgeProviders(
  db: ConsolidationDb,
  workspaceId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ llmProvider: LLMProvider, embeddingProvider?: EmbeddingProvider }> {
  const consolidationSettings = await resolveConsolidationProviderSettings(db, workspaceId, env)
  const { provider: llmProvider } = resolveLLMProvider('consolidation', env, consolidationSettings)

  const embeddingSettings = await resolveEmbeddingProviderSettings(db, workspaceId, env)
  const { provider: embeddingProvider } = createEmbeddingProvider(env, embeddingSettings)

  return { llmProvider, embeddingProvider }
}

function buildJudgeMessages(request: ConsolidationJudgeRequest): import('../ai/types').ChatMessage[] {
  const mergeSection = request.mergePairs.length > 0
    ? [
        'Merge candidates (pairs of concepts or topics that may be duplicates):',
        ...request.mergePairs.map(formatMergeCandidate),
      ]
    : ['No merge candidates.']

  const pruneSection = request.pruneCandidates.length > 0
    ? [
        'Prune candidates (concepts or topics that may be junk/noise):',
        ...request.pruneCandidates.map(formatPruneCandidate),
      ]
    : ['No prune candidates.']

  return [
    {
      role: 'system',
      content: [
        'You are a vocabulary consolidation judge for a personal knowledge graph.',
        'For each merge candidate, decide whether the two items are duplicates. If yes, pick the survivor (the ID to keep), write a merged description, and explain why.',
        'For each prune candidate, decide whether it is junk or noise that should be removed, and explain why.',
        'Return JSON matching the provided schema.',
      ].join(' '),
    },
    {
      role: 'user',
      content: [...mergeSection, '', ...pruneSection].join('\n'),
    },
  ]
}

function formatMergeCandidate(pair: MergeCandidate): string {
  return [
    `- pair_id: ${pair.pairId}`,
    `  kind: ${pair.kind}`,
    `  item 1: ${pair.name} (${pair.description ?? 'no description'})`,
    `  item 2: ${pair.otherName} (${pair.otherDescription ?? 'no description'})`,
    `  similarity: ${pair.similarity.toFixed(3)}`,
  ].join('\n')
}

function formatPruneCandidate(candidate: PruneCandidate): string {
  return [
    `- id: ${candidate.id}`,
    `  kind: ${candidate.kind}`,
    `  name: ${candidate.name}`,
    `  description: ${candidate.description ?? 'no description'}`,
    `  mentions: ${candidate.mentionCount}`,
    `  relations: ${candidate.relationCount}`,
    `  sample chunk: ${candidate.sampleChunkText ?? 'none'}`,
  ].join('\n')
}

export async function makeDefaultJudge(
  db: ConsolidationDb,
  workspaceId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ judge: ConsolidationJudge, embeddingProvider?: EmbeddingProvider }> {
  const { llmProvider, embeddingProvider } = await resolveJudgeProviders(db, workspaceId, env)
  return {
    judge: createDefaultJudge({ llmProvider, embeddingProvider }),
    embeddingProvider,
  }
}
