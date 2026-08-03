import type { GraphDb } from './age'
import { agLiteral, parseAgtype, queryCypher } from './age'

export interface GraphNode {
  id: string
  label: 'Concept' | 'Note' | 'Tag' | 'Topic'
  name: string
  ref: string
}

export interface GraphEdge {
  source: string
  target: string
  type: 'RELATES_TO' | 'MENTIONS' | 'TAGGED' | 'LINKS' | 'GROUPED_UNDER'
  edgeType?: string
}

export interface ConceptSummary {
  id: string
  name: string
  description: string | null
  mentionCount: number
  topics: string[]
}

export interface ConceptNeighbor {
  id: string
  name: string
  type: string
  weight: number
}

export interface MentionedNote {
  path: string
  title: string
}

export interface ConceptDetail {
  concept: {
    id: string
    name: string
    description: string | null
    topics: string[]
  }
  neighbors: ConceptNeighbor[]
  mentionedIn: MentionedNote[]
}

export function parseOptionalString(value: unknown): string | undefined {
  const parsed = parseAgtype(value)
  return typeof parsed === 'string' ? parsed : undefined
}

const EGO_EDGE_TYPES = ['RELATES_TO', 'MENTIONS', 'TAGGED', 'LINKS', 'GROUPED_UNDER'] as const
type EgoEdgeType = typeof EGO_EDGE_TYPES[number]

/**
 * Topic overview for the graph page's default view: every Topic node plus
 * the top 10 Concepts per Topic by mention count (ties broken by name asc),
 * and only the edges among the included nodes (GROUPED_UNDER + RELATES_TO).
 * Topic membership comes from the relational `concept_topics` mirror; node
 * names come from the AGE vertices.
 */
export async function getTopicOverview(
  db: GraphDb,
  workspaceId: string,
): Promise<{ nodes: GraphNode[], edges: GraphEdge[] }> {
  const ws = agLiteral(workspaceId)

  const topicRows = await queryCypher<{ id: unknown, name: unknown }>(
    db,
    `MATCH (n:Topic) WHERE n.workspace_id = ${ws} RETURN n.id AS id, n.name AS name`,
    'id ag_catalog.agtype, name ag_catalog.agtype',
  )

  // Per (concept, topic) mention counts straight from the relational mirror.
  // COUNT(DISTINCT mentions.id) so the topic fan-out never inflates counts.
  const membershipRows = await db
    .selectFrom('concept_topics')
    .leftJoin('mentions', join => join
      .onRef('mentions.concept_id', '=', 'concept_topics.concept_id')
      .onRef('mentions.workspace_id', '=', 'concept_topics.workspace_id'))
    .select([
      'concept_topics.concept_id',
      'concept_topics.topic_id',
      eb => eb.fn.count('mentions.id').distinct().as('mention_count'),
    ])
    .where('concept_topics.workspace_id', '=', workspaceId)
    .groupBy(['concept_topics.concept_id', 'concept_topics.topic_id'])
    .execute()

  const perTopic = new Map<string, Array<{ conceptId: string, count: number }>>()
  const candidateIds = new Set<string>()
  for (const row of membershipRows) {
    const conceptId = String(row.concept_id)
    const topicId = String(row.topic_id)
    const count = Number(row.mention_count)
    const list = perTopic.get(topicId) ?? []
    list.push({ conceptId, count })
    perTopic.set(topicId, list)
    candidateIds.add(conceptId)
  }

  // Concept names come from the AGE vertices (same source getFullGraph used).
  const conceptNameById = new Map<string, string>()
  if (candidateIds.size > 0) {
    const idList = [...candidateIds].map(id => agLiteral(id)).join(', ')
    const conceptRows = await queryCypher<{ id: unknown, name: unknown }>(
      db,
      `MATCH (n:Concept) WHERE n.workspace_id = ${ws} AND n.id IN [${idList}] RETURN n.id AS id, n.name AS name`,
      'id ag_catalog.agtype, name ag_catalog.agtype',
    )
    for (const row of conceptRows)
      conceptNameById.set(String(parseAgtype(row.id)), parseOptionalString(row.name) ?? String(parseAgtype(row.id)))
  }

  // Top 10 concepts per topic by mention count, ties broken by name asc.
  const includedConceptIds = new Set<string>()
  for (const list of perTopic.values()) {
    list.sort((a, b) => b.count - a.count
      || (conceptNameById.get(a.conceptId) ?? a.conceptId).localeCompare(conceptNameById.get(b.conceptId) ?? b.conceptId))
    for (const { conceptId } of list.slice(0, 10))
      includedConceptIds.add(conceptId)
  }

  const topicNodes: GraphNode[] = topicRows.map((row) => {
    const id = String(parseAgtype(row.id))
    return { id, label: 'Topic', name: parseOptionalString(row.name) ?? id, ref: id }
  })
  const topicIds = new Set(topicNodes.map(n => n.id))

  const conceptNodes: GraphNode[] = [...includedConceptIds]
    .filter(id => conceptNameById.has(id))
    .map(id => ({ id, label: 'Concept', name: conceptNameById.get(id)!, ref: id }))

  const groupedUnderRows = await queryCypher<{ source: unknown, target: unknown }>(
    db,
    `MATCH (a:Concept)-[r:GROUPED_UNDER]->(b:Topic) WHERE r.workspace_id = ${ws} RETURN a.id AS source, b.id AS target`,
    'source ag_catalog.agtype, target ag_catalog.agtype',
  )

  const relatesToRows = await queryCypher<{ source: unknown, target: unknown, type: unknown }>(
    db,
    `MATCH (a:Concept)-[r:RELATES_TO]->(b:Concept) WHERE r.workspace_id = ${ws} RETURN a.id AS source, b.id AS target, r.type AS type`,
    'source ag_catalog.agtype, target ag_catalog.agtype, type ag_catalog.agtype',
  )

  const edges: GraphEdge[] = [
    ...groupedUnderRows
      .map(row => ({
        source: String(parseAgtype(row.source)),
        target: String(parseAgtype(row.target)),
      }))
      .filter(e => includedConceptIds.has(e.source) && topicIds.has(e.target))
      .map(e => ({ ...e, type: 'GROUPED_UNDER' as const })),
    ...relatesToRows
      .map(row => ({
        source: String(parseAgtype(row.source)),
        target: String(parseAgtype(row.target)),
        edgeType: parseOptionalString(row.type),
      }))
      .filter(e => includedConceptIds.has(e.source) && includedConceptIds.has(e.target))
      .map(e => ({ ...e, type: 'RELATES_TO' as const })),
  ]

  return { nodes: [...conceptNodes, ...topicNodes], edges }
}

/**
 * Ego graph around `nodeId`: every vertex reachable through any of the five
 * edge types within `depth` hops (undirected, depth clamped to [1, 2]),
 * plus the edges on those paths. The center node is always included. An
 * unknown node (or one outside the workspace) yields an empty payload.
 * Note nodes resolve name/ref from the `notes` table; Concept/Tag/Topic
 * names come from the AGE vertex properties.
 */
export async function getEgoGraph(
  db: GraphDb,
  workspaceId: string,
  nodeId: string,
  depth: number,
): Promise<{ nodes: GraphNode[], edges: GraphEdge[] }> {
  const clamped = Math.min(2, Math.max(1, Math.floor(depth)))
  const ws = agLiteral(workspaceId)

  // Single undirected traversal over ALL edge types (mixed-type paths like
  // Concept -MENTIONS-> Note -TAGGED-> Tag count as one hop); the edge label
  // comes back via label(rel) since AGE lacks type()/alternation support.
  const edgeRows = await queryCypher<{ source: unknown, target: unknown, edge_type: unknown, relation_type: unknown, workspace_id: unknown }>(
    db,
    [
      `MATCH p = (start {id: ${agLiteral(nodeId)}})-[*1..${clamped}]-(n)`,
      `WHERE start.workspace_id = ${ws} AND n.workspace_id = ${ws}`,
      'UNWIND relationships(p) AS rel',
      'RETURN DISTINCT startNode(rel).id AS source, endNode(rel).id AS target, label(rel) AS edge_type, rel.type AS relation_type, rel.workspace_id AS workspace_id',
    ].join(' '),
    'source ag_catalog.agtype, target ag_catalog.agtype, edge_type ag_catalog.agtype, relation_type ag_catalog.agtype, workspace_id ag_catalog.agtype',
  )

  const edges: GraphEdge[] = []
  const endpointIds = new Set<string>()
  for (const row of edgeRows) {
    if (String(parseAgtype(row.workspace_id)) !== workspaceId)
      continue
    const edgeType = parseOptionalString(row.edge_type)
    if (!edgeType || !(EGO_EDGE_TYPES as readonly string[]).includes(edgeType))
      continue
    const source = String(parseAgtype(row.source))
    const target = String(parseAgtype(row.target))
    const relationType = parseOptionalString(row.relation_type)
    const edge: GraphEdge = { source, target, type: edgeType as EgoEdgeType }
    if (edgeType === 'RELATES_TO' && relationType)
      edge.edgeType = relationType
    edges.push(edge)
    endpointIds.add(source)
    endpointIds.add(target)
  }

  const allIds = [...endpointIds]
  allIds.push(nodeId)

  // Note nodes resolve from the relational table (title/path), like getFullGraph did.
  const noteInfo = new Map<string, { title: string, path: string }>()
  if (allIds.length > 0) {
    const notes = await db
      .selectFrom('notes')
      .select(['id', 'title', 'path'])
      .where('workspace_id', '=', workspaceId)
      .where('id', 'in', allIds)
      .execute()
    for (const note of notes)
      noteInfo.set(note.id, { title: note.title, path: note.path })
  }

  const nonNoteIds = allIds.filter(id => !noteInfo.has(id))
  const vertexById = new Map<string, { label: 'Concept' | 'Tag' | 'Topic', name: string }>()
  if (nonNoteIds.length > 0) {
    const idList = nonNoteIds.map(id => agLiteral(id)).join(', ')
    for (const label of ['Concept', 'Tag', 'Topic'] as const) {
      const rows = await queryCypher<{ id: unknown, name: unknown }>(
        db,
        `MATCH (n:${label}) WHERE n.workspace_id = ${ws} AND n.id IN [${idList}] RETURN n.id AS id, n.name AS name`,
        'id ag_catalog.agtype, name ag_catalog.agtype',
      )
      for (const row of rows)
        vertexById.set(String(parseAgtype(row.id)), { label, name: parseOptionalString(row.name) ?? String(parseAgtype(row.id)) })
    }
  }

  const foundIds = new Set([...noteInfo.keys(), ...vertexById.keys()])
  if (!foundIds.has(nodeId))
    return { nodes: [], edges: [] }

  const nodes: GraphNode[] = [...foundIds].map((id): GraphNode => {
    const note = noteInfo.get(id)
    if (note)
      return { id, label: 'Note', name: note.title, ref: note.path }
    const vertex = vertexById.get(id)
    if (vertex)
      return { id, label: vertex.label, name: vertex.name, ref: id }
    // unreachable: foundIds is built from these two maps
    return { id, label: 'Concept', name: id, ref: id }
  })

  const includedEdges = edges.filter(e => foundIds.has(e.source) && foundIds.has(e.target))
  return { nodes, edges: includedEdges }
}

export function toConceptSummaries(
  rows: Array<{ id: string, name: string, description: string | null, mention_count: string | number | bigint, topics?: string[] | null }>,
): ConceptSummary[] {
  return rows
    .map(row => ({
      id: row.id,
      name: row.name,
      description: row.description ?? null,
      mentionCount: Number(row.mention_count),
      topics: row.topics ?? [],
    }))
    .sort((a, b) => b.mentionCount - a.mentionCount || a.name.localeCompare(b.name))
}

export async function getConceptList(db: GraphDb, workspaceId: string): Promise<ConceptSummary[]> {
  const rows = await db
    .selectFrom('concepts')
    .leftJoin('mentions', 'mentions.concept_id', 'concepts.id')
    .select([
      'concepts.id',
      'concepts.name',
      'concepts.description',
      eb => eb.fn.count('mentions.id').as('mention_count'),
    ])
    .where('concepts.workspace_id', '=', workspaceId)
    .groupBy(['concepts.id', 'concepts.name', 'concepts.description'])
    .execute()

  if (rows.length === 0) {
    return []
  }

  const conceptIds = rows.map(r => r.id)
  const topicRows = await db
    .selectFrom('concept_topics')
    .innerJoin('topics', 'topics.id', 'concept_topics.topic_id')
    .select(['concept_topics.concept_id', 'topics.name'])
    .where('concept_topics.workspace_id', '=', workspaceId)
    .where('concept_topics.concept_id', 'in', conceptIds)
    .orderBy('topics.name', 'asc')
    .execute()

  const topicsByConcept = new Map<string, string[]>()
  for (const row of topicRows) {
    const list = topicsByConcept.get(row.concept_id) ?? []
    list.push(row.name)
    topicsByConcept.set(row.concept_id, list)
  }

  return toConceptSummaries(
    rows.map(row => ({
      ...row,
      topics: topicsByConcept.get(row.id) ?? [],
    })),
  )
}

export async function getConceptDetail(
  db: GraphDb,
  workspaceId: string,
  conceptId: string,
): Promise<ConceptDetail | null> {
  const concept = await db
    .selectFrom('concepts')
    .select(['id', 'name', 'description'])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', conceptId)
    .executeTakeFirst()

  if (!concept) {
    return null
  }

  const relations = await db
    .selectFrom('relations')
    .select(['relations.from_concept_id', 'relations.to_concept_id', 'relations.type'])
    .where('relations.workspace_id', '=', workspaceId)
    .where(eb =>
      eb('relations.from_concept_id', '=', conceptId)
        .or('relations.to_concept_id', '=', conceptId))
    .execute()

  const neighborIds = relations.map(r =>
    r.from_concept_id === conceptId ? r.to_concept_id : r.from_concept_id,
  )

  const neighbors = neighborIds.length > 0
    ? await db
        .selectFrom('concepts')
        .select(['id', 'name'])
        .where('id', 'in', neighborIds)
        .execute()
    : []

  const neighborById = new Map(neighbors.map(n => [n.id, n.name]))

  const mentionedIn = await db
    .selectFrom('mentions')
    .innerJoin('chunks', 'chunks.id', 'mentions.chunk_id')
    .innerJoin('notes', 'notes.id', 'chunks.note_id')
    .select(['notes.path', 'notes.title'])
    .where('mentions.workspace_id', '=', workspaceId)
    .where('mentions.concept_id', '=', conceptId)
    .groupBy(['notes.id', 'notes.path', 'notes.title'])
    .execute()

  const topics = await db
    .selectFrom('concept_topics')
    .innerJoin('topics', 'topics.id', 'concept_topics.topic_id')
    .select('topics.name')
    .where('concept_topics.workspace_id', '=', workspaceId)
    .where('concept_topics.concept_id', '=', conceptId)
    .orderBy('topics.name', 'asc')
    .execute()

  return {
    concept: {
      id: concept.id,
      name: concept.name,
      description: concept.description ?? null,
      topics: topics.map(t => t.name),
    },
    neighbors: relations.map((r) => {
      const neighborId = r.from_concept_id === conceptId ? r.to_concept_id : r.from_concept_id
      return {
        id: neighborId,
        name: neighborById.get(neighborId) ?? neighborId,
        type: r.type,
        weight: 1,
      }
    }),
    mentionedIn: mentionedIn.map(n => ({
      path: n.path,
      title: n.title,
    })),
  }
}
