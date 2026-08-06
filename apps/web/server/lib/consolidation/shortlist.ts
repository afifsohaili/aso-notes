import type { ConsolidationDb, ConsolidationJudge, MergeCandidate, MergeVerdict, PruneCandidate, PruneVerdict } from './types'
import { sql } from 'kysely'
import { COSINE_THRESHOLD, JUDGE_BATCH_SIZE, NEIGHBOR_TOP_K, PRUNE_GRACE_DAYS } from './types'

interface ConceptRow {
  id: string
  name: string
  description: string | null
}

interface TopicRow {
  id: string
  name: string
  description: string | null
}

export function pairId(id1: string, id2: string): string {
  return id1 < id2 ? `${id1}::${id2}` : `${id2}::${id1}`
}

export function loserIdFromVerdict(verdict: { pairId: string, survivorId: string }): string {
  const [id1, id2] = verdict.pairId.split('::')
  return id1 === verdict.survivorId ? id2! : id1!
}

export function cosineFromDistance(distance: number): number {
  return 1 - distance
}

async function findConceptNeighbors(
  db: ConsolidationDb,
  workspaceId: string,
  conceptId: string,
  excludeIds: Set<string>,
): Promise<Array<ConceptRow & { distance: number }>> {
  let query = db
    .selectFrom('concepts as neighbor')
    .select(['neighbor.id', 'neighbor.name', 'neighbor.description', sql<number>`neighbor.embedding <=> (SELECT embedding FROM concepts WHERE id = ${conceptId})`.as('distance')])
    .where('neighbor.workspace_id', '=', workspaceId)
    .where('neighbor.id', '!=', conceptId)
    .where('neighbor.embedding', 'is not', null)

  if (excludeIds.size > 0)
    query = query.where('neighbor.id', 'not in', [...excludeIds])

  return query
    .orderBy('distance')
    .limit(NEIGHBOR_TOP_K)
    .execute() as any
}

async function findTopicNeighbors(
  db: ConsolidationDb,
  workspaceId: string,
  topicId: string,
  excludeIds: Set<string>,
): Promise<Array<TopicRow & { distance: number }>> {
  let query = db
    .selectFrom('topics as neighbor')
    .select(['neighbor.id', 'neighbor.name', 'neighbor.description', sql<number>`neighbor.embedding <=> (SELECT embedding FROM topics WHERE id = ${topicId})`.as('distance')])
    .where('neighbor.workspace_id', '=', workspaceId)
    .where('neighbor.id', '!=', topicId)
    .where('neighbor.embedding', 'is not', null)

  if (excludeIds.size > 0)
    query = query.where('neighbor.id', 'not in', [...excludeIds])

  return query
    .orderBy('distance')
    .limit(NEIGHBOR_TOP_K)
    .execute() as any
}

export async function buildMergePairs(
  db: ConsolidationDb,
  workspaceId: string,
  mode: 'full' | 'incremental' | 'manual',
  hwm: Date | null,
): Promise<MergeCandidate[]> {
  const pairs = new Map<string, MergeCandidate>()
  const deletedIds = new Set<string>()

  const concepts = await db
    .selectFrom('concepts')
    .select(['id', 'name', 'description', 'created_at'])
    .where('workspace_id', '=', workspaceId)
    .where('embedding', 'is not', null)
    .execute()

  const conceptRows = mode === 'incremental' && hwm
    ? concepts.filter(c => new Date(c.created_at) > hwm)
    : concepts

  for (const concept of conceptRows) {
    if (deletedIds.has(concept.id))
      continue

    const neighbors = await findConceptNeighbors(db, workspaceId, concept.id, deletedIds)
    for (const neighbor of neighbors) {
      const similarity = cosineFromDistance(neighbor.distance)
      if (similarity < COSINE_THRESHOLD)
        continue

      const pid = pairId(concept.id, neighbor.id)
      if (pairs.has(pid))
        continue

      pairs.set(pid, {
        kind: 'concept',
        pairId: pid,
        id: concept.id,
        name: concept.name,
        description: concept.description,
        otherId: neighbor.id,
        otherName: neighbor.name,
        otherDescription: neighbor.description,
        similarity,
      })
    }
  }

  const topics = await db
    .selectFrom('topics')
    .select(['id', 'name', 'description', 'created_at'])
    .where('workspace_id', '=', workspaceId)
    .where('embedding', 'is not', null)
    .execute()

  const topicRows = mode === 'incremental' && hwm
    ? topics.filter(t => new Date(t.created_at) > hwm)
    : topics

  for (const topic of topicRows) {
    if (deletedIds.has(topic.id))
      continue

    const neighbors = await findTopicNeighbors(db, workspaceId, topic.id, deletedIds)
    for (const neighbor of neighbors) {
      const similarity = cosineFromDistance(neighbor.distance)
      if (similarity < COSINE_THRESHOLD)
        continue

      const pid = pairId(topic.id, neighbor.id)
      if (pairs.has(pid))
        continue

      pairs.set(pid, {
        kind: 'topic',
        pairId: pid,
        id: topic.id,
        name: topic.name,
        description: topic.description,
        otherId: neighbor.id,
        otherName: neighbor.name,
        otherDescription: neighbor.description,
        similarity,
      })
    }
  }

  return [...pairs.values()].sort((a, b) => b.similarity - a.similarity)
}

export async function buildPruneCandidates(
  db: ConsolidationDb,
  workspaceId: string,
  excludeIds: Set<string>,
  now: Date,
): Promise<PruneCandidate[]> {
  const cutoff = new Date(now.getTime() - PRUNE_GRACE_DAYS * 24 * 60 * 60 * 1000)

  const concepts = await db
    .selectFrom('concepts')
    .select(['id', 'name', 'description', 'created_at'])
    .where('workspace_id', '=', workspaceId)
    .where('created_at', '<', cutoff)
    .execute()

  const candidates: PruneCandidate[] = []
  for (const concept of concepts) {
    if (excludeIds.has(concept.id))
      continue

    const mentionCount = await db
      .selectFrom('mentions')
      .select(sql<number>`count(*)::int`.as('c'))
      .where('workspace_id', '=', workspaceId)
      .where('concept_id', '=', concept.id)
      .executeTakeFirstOrThrow()

    if (Number(mentionCount.c) > 1)
      continue

    const relationCount = await db
      .selectFrom('relations')
      .select(sql<number>`count(*)::int`.as('c'))
      .where('workspace_id', '=', workspaceId)
      .where(eb => eb.or([
        eb('from_concept_id', '=', concept.id),
        eb('to_concept_id', '=', concept.id),
      ]))
      .executeTakeFirstOrThrow()

    if (Number(relationCount.c) > 1)
      continue

    const sample = await db
      .selectFrom('mentions')
      .innerJoin('chunks', 'chunks.id', 'mentions.chunk_id')
      .select('chunks.text')
      .where('mentions.workspace_id', '=', workspaceId)
      .where('mentions.concept_id', '=', concept.id)
      .limit(1)
      .executeTakeFirst()

    candidates.push({
      kind: 'concept',
      id: concept.id,
      name: concept.name,
      description: concept.description,
      mentionCount: Number(mentionCount.c),
      relationCount: Number(relationCount.c),
      sampleChunkText: sample?.text ?? null,
    })
  }

  return candidates
}

export async function buildSingletonTopicCandidates(
  db: ConsolidationDb,
  workspaceId: string,
): Promise<PruneCandidate[]> {
  const rows = await db
    .selectFrom('topics')
    .innerJoin('concept_topics', join => join
      .onRef('concept_topics.topic_id', '=', 'topics.id')
      .on('concept_topics.workspace_id', '=', workspaceId))
    .select(['topics.id', 'topics.name', 'topics.description'])
    .select(sql<number>`count(*)::int`.as('concept_count'))
    .where('topics.workspace_id', '=', workspaceId)
    .groupBy(['topics.id', 'topics.name', 'topics.description'])
    .having(sql<number>`count(*)`, '=', 1)
    .execute()

  return rows.map(t => ({
    kind: 'topic' as const,
    id: t.id,
    name: t.name,
    description: t.description,
    mentionCount: 0,
    relationCount: 0,
    sampleChunkText: null,
  }))
}

export interface BatchJudgeResult {
  merges: MergeVerdict[]
  prunes: PruneVerdict[]
  judgeCalls: number
  skippedInvalidVerdicts: number
}

/**
 * Validate a merge verdict against the candidate set that was actually sent
 * to the judge. The LLM can hallucinate: unknown pair ids, self-pairs
 * (`X::X`, which would make survivor === loser and delete the concept), a
 * survivor outside the pair (which would merge arbitrary concepts), a wrong
 * kind, or the same verdict repeated across batches. Invalid verdicts are
 * dropped and counted as skipped — never executed.
 */
function isValidMergeVerdict(verdict: MergeVerdict, candidate: MergeCandidate | undefined, seen: Set<string>): boolean {
  if (!candidate || candidate.kind !== verdict.kind)
    return false
  const [id1, id2] = verdict.pairId.split('::')
  if (!id1 || !id2 || id1 === id2)
    return false
  if (verdict.survivorId !== id1 && verdict.survivorId !== id2)
    return false
  if (seen.has(verdict.pairId))
    return false
  return true
}

function isValidPruneVerdict(verdict: PruneVerdict, candidate: PruneCandidate | undefined, seen: Set<string>): boolean {
  if (!candidate || candidate.kind !== verdict.kind)
    return false
  if (seen.has(verdict.id))
    return false
  return true
}

export async function batchJudge(
  judge: ConsolidationJudge,
  pairs: MergeCandidate[],
  prunes: PruneCandidate[],
): Promise<BatchJudgeResult> {
  const pairById = new Map(pairs.map(p => [p.pairId, p]))
  const pruneById = new Map(prunes.map(p => [p.id, p]))
  const seenPairIds = new Set<string>()
  const seenPruneIds = new Set<string>()
  const merges: MergeVerdict[] = []
  const prunesOut: PruneVerdict[] = []
  let judgeCalls = 0
  let skippedInvalidVerdicts = 0

  for (let i = 0; i < pairs.length; i += JUDGE_BATCH_SIZE) {
    const batch = pairs.slice(i, i + JUDGE_BATCH_SIZE)
    const response = await judge({ mergePairs: batch, pruneCandidates: [] })
    judgeCalls++
    for (const verdict of response.merges) {
      if (!isValidMergeVerdict(verdict, pairById.get(verdict.pairId), seenPairIds)) {
        skippedInvalidVerdicts++
        continue
      }
      seenPairIds.add(verdict.pairId)
      merges.push(verdict)
    }
  }

  for (let i = 0; i < prunes.length; i += JUDGE_BATCH_SIZE) {
    const batch = prunes.slice(i, i + JUDGE_BATCH_SIZE)
    const response = await judge({ mergePairs: [], pruneCandidates: batch })
    judgeCalls++
    for (const verdict of response.prunes) {
      if (!isValidPruneVerdict(verdict, pruneById.get(verdict.id), seenPruneIds)) {
        skippedInvalidVerdicts++
        continue
      }
      seenPruneIds.add(verdict.id)
      prunesOut.push(verdict)
    }
  }

  return { merges, prunes: prunesOut, judgeCalls, skippedInvalidVerdicts }
}
