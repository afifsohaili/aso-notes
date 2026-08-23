import type { AgentDb } from '../agent/types'
import { agLiteral, parseAgtype, queryCypher } from '../graph/age'

/**
 * Graph expansion for search_notes (plan-002 §Graph Expansion). After hybrid
 * ranking produces the top fused Chunks, this walks one hop of RELATES_TO
 * edges in the AGE graph from the Concepts those Chunks mention, and returns
 * Mentions of the neighboring Concepts — but only from Notes that did not
 * already surface as direct hits. Each entry carries its provenance chain so
 * the Agent can explain why the material was included.
 *
 * Lives in the retrieval module (not the Tool) to keep the Tool an
 * orchestrator; the graph traversal is the only part touching AGE.
 */

/** A single related Chunk with its provenance chain. */
export interface RelatedChunk {
  path: string
  title: string
  text: string
  seq: number
  provenance: {
    matchedConcept: string
    neighborConcept: string
    relationType: string
    /** The direct-hit Chunk whose Mention of the matched Concept led here. */
    matchedChunk: { path: string, seq: number }
  }
}

interface NeighborRow extends Record<string, unknown> {
  matched_id: unknown
  matched_name: unknown
  neighbor_id: unknown
  neighbor_name: unknown
  relation_type: unknown
}

/**
 * Collect the Concepts Mentioned in the direct result Chunks, traverse one
 * hop of RELATES_TO in the AGE graph, and return up to `relatedLimit`
 * related Mentions from Notes excluded from the direct result. Empty when
 * `relatedLimit` is 0, no Concepts match, or no Relations exist.
 */
export async function expandRelatedChunks(
  db: AgentDb,
  workspaceId: string,
  args: { resultChunkIds: string[], excludedNoteIds: string[], relatedLimit: number },
): Promise<RelatedChunk[]> {
  const { resultChunkIds, excludedNoteIds, relatedLimit } = args
  if (relatedLimit <= 0 || resultChunkIds.length === 0)
    return []

  // 1. Concepts mentioned in the direct result Chunks.
  const matchedRows = await db
    .selectFrom('mentions')
    .select('concept_id')
    .distinct()
    .where('workspace_id', '=', workspaceId)
    .where('chunk_id', 'in', resultChunkIds)
    .execute()
  const matchedIds = matchedRows.map(r => r.concept_id)
  if (matchedIds.length === 0)
    return []

  // 1b. The direct-hit Chunk (Note path + seq) that Mentioned each matched
  // Concept, so provenance can trace the full chain. When several direct
  // Chunks mention the same Concept, the first by (path, seq) wins.
  const matchedChunkRows = await db
    .selectFrom('mentions')
    .innerJoin('chunks', 'chunks.id', 'mentions.chunk_id')
    .innerJoin('notes', 'notes.id', 'chunks.note_id')
    .select(['mentions.concept_id', 'notes.path', 'chunks.seq'])
    .where('mentions.workspace_id', '=', workspaceId)
    .where('mentions.concept_id', 'in', matchedIds)
    .where('mentions.chunk_id', 'in', resultChunkIds)
    .orderBy(['notes.path', 'chunks.seq'])
    .execute()
  const matchedChunkByConcept = new Map<string, { path: string, seq: number }>()
  for (const row of matchedChunkRows) {
    if (!matchedChunkByConcept.has(row.concept_id))
      matchedChunkByConcept.set(row.concept_id, { path: row.path, seq: row.seq })
  }

  // 2. One hop of RELATES_TO from those Concepts (Workspace-scoped neighbors).
  const idList = matchedIds.map(id => agLiteral(id)).join(', ')
  const neighborRows = await queryCypher<NeighborRow>(
    db,
    [
      `MATCH (a:Concept)-[r:RELATES_TO]-(b:Concept)`,
      `WHERE a.id IN [${idList}] AND b.workspace_id = ${agLiteral(workspaceId)} AND b.id <> a.id`,
      `RETURN a.id AS matched_id, a.name AS matched_name, b.id AS neighbor_id, b.name AS neighbor_name, r.type AS relation_type`,
    ].join(' '),
    'matched_id ag_catalog.agtype, matched_name ag_catalog.agtype, neighbor_id ag_catalog.agtype, neighbor_name ag_catalog.agtype, relation_type ag_catalog.agtype',
  )

  // 3. Mentions of neighbors, from Notes outside the direct result set.
  const seenChunk = new Set<string>()
  const related: RelatedChunk[] = []
  for (const row of neighborRows) {
    const neighborId = String(parseAgtype(row.neighbor_id))
    const neighborName = String(parseAgtype(row.neighbor_name))
    const matchedName = String(parseAgtype(row.matched_name))
    const relationType = String(parseAgtype(row.relation_type))
    const matchedChunk = matchedChunkByConcept.get(String(parseAgtype(row.matched_id)))

    let query = db
      .selectFrom('mentions')
      .innerJoin('chunks', 'chunks.id', 'mentions.chunk_id')
      .innerJoin('notes', 'notes.id', 'chunks.note_id')
      .select([
        'chunks.id',
        'notes.path',
        'notes.title',
        'chunks.text',
        'chunks.seq',
      ])
      .where('mentions.workspace_id', '=', workspaceId)
      .where('mentions.concept_id', '=', neighborId)
      .orderBy(['notes.path', 'chunks.seq'])
      .limit(relatedLimit)
    if (excludedNoteIds.length > 0)
      query = query.where('notes.id', 'not in', excludedNoteIds)

    const mentionRows = await query.execute()
    for (const m of mentionRows) {
      if (seenChunk.has(m.id))
        continue
      seenChunk.add(m.id)
      related.push({
        path: m.path,
        title: m.title,
        text: m.text,
        seq: m.seq,
        provenance: {
          matchedConcept: matchedName,
          neighborConcept: neighborName,
          relationType,
          matchedChunk: matchedChunk ?? { path: '', seq: 0 },
        },
      })
    }
  }

  return related.slice(0, relatedLimit)
}
