import type { GraphDb } from './age'
import { agLiteral, parseAgtype, queryCypher } from './age'

export interface GraphNode {
  id: string
  label: 'Concept' | 'Note' | 'Tag'
  name: string
  ref: string
}

export interface GraphEdge {
  source: string
  target: string
  type: 'RELATES_TO' | 'MENTIONS' | 'TAGGED' | 'LINKS'
  edgeType?: string
}

export interface ConceptSummary {
  id: string
  name: string
  description: string | null
  mentionCount: number
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
  }
  neighbors: ConceptNeighbor[]
  mentionedIn: MentionedNote[]
}

export function parseOptionalString(value: unknown): string | undefined {
  const parsed = parseAgtype(value)
  return typeof parsed === 'string' ? parsed : undefined
}

export async function getFullGraph(db: GraphDb, workspaceId: string): Promise<{ nodes: GraphNode[], edges: GraphEdge[] }> {
  const conceptRows = await queryCypher<{ id: unknown, name: unknown }>(
    db,
    `MATCH (n:Concept) WHERE n.workspace_id = ${agLiteral(workspaceId)} RETURN n.id AS id, n.name AS name`,
    'id ag_catalog.agtype, name ag_catalog.agtype',
  )

  const noteRows = await queryCypher<{ id: unknown }>(
    db,
    `MATCH (n:Note) WHERE n.workspace_id = ${agLiteral(workspaceId)} RETURN n.id AS id`,
    'id ag_catalog.agtype',
  )

  const tagRows = await queryCypher<{ id: unknown, name: unknown }>(
    db,
    `MATCH (n:Tag) WHERE n.workspace_id = ${agLiteral(workspaceId)} RETURN n.id AS id, n.name AS name`,
    'id ag_catalog.agtype, name ag_catalog.agtype',
  )

  const relatesToRows = await queryCypher<{ source: unknown, target: unknown, type: unknown }>(
    db,
    `MATCH (a)-[r:RELATES_TO]->(b) WHERE r.workspace_id = ${agLiteral(workspaceId)} RETURN a.id AS source, b.id AS target, r.type AS type`,
    'source ag_catalog.agtype, target ag_catalog.agtype, type ag_catalog.agtype',
  )

  const mentionsEdgeRows = await queryCypher<{ source: unknown, target: unknown }>(
    db,
    `MATCH (a:Note)-[r:MENTIONS]->(b:Concept) WHERE r.workspace_id = ${agLiteral(workspaceId)} RETURN a.id AS source, b.id AS target`,
    'source ag_catalog.agtype, target ag_catalog.agtype',
  )

  const taggedEdgeRows = await queryCypher<{ source: unknown, target: unknown }>(
    db,
    `MATCH (a:Note)-[r:TAGGED]->(b:Tag) WHERE r.workspace_id = ${agLiteral(workspaceId)} RETURN a.id AS source, b.id AS target`,
    'source ag_catalog.agtype, target ag_catalog.agtype',
  )

  const linksEdgeRows = await queryCypher<{ source: unknown, target: unknown }>(
    db,
    `MATCH (a:Note)-[r:LINKS]->(b:Note) WHERE r.workspace_id = ${agLiteral(workspaceId)} RETURN a.id AS source, b.id AS target`,
    'source ag_catalog.agtype, target ag_catalog.agtype',
  )

  const noteIds = noteRows.map(row => String(parseAgtype(row.id)))
  const notePaths = new Map<string, { title: string, path: string }>()
  if (noteIds.length > 0) {
    const notes = await db
      .selectFrom('notes')
      .select(['id', 'title', 'path'])
      .where('id', 'in', noteIds)
      .execute()
    for (const note of notes) {
      notePaths.set(note.id, { title: note.title, path: note.path })
    }
  }

  const conceptNodes: GraphNode[] = conceptRows.map(row => ({
    id: String(parseAgtype(row.id)),
    label: 'Concept',
    name: parseOptionalString(row.name) ?? String(parseAgtype(row.id)),
    ref: String(parseAgtype(row.id)),
  }))

  const noteNodes: GraphNode[] = noteRows.map((row) => {
    const id = String(parseAgtype(row.id))
    const info = notePaths.get(id)
    return {
      id,
      label: 'Note',
      name: info?.title ?? id,
      ref: info?.path ?? id,
    }
  })

  const tagNodes: GraphNode[] = tagRows.map(row => ({
    id: String(parseAgtype(row.id)),
    label: 'Tag',
    name: parseOptionalString(row.name) ?? String(parseAgtype(row.id)),
    ref: String(parseAgtype(row.id)),
  }))

  const edges: GraphEdge[] = [
    ...relatesToRows.map(row => ({
      source: String(parseAgtype(row.source)),
      target: String(parseAgtype(row.target)),
      type: 'RELATES_TO' as const,
      edgeType: parseOptionalString(row.type),
    })),
    ...mentionsEdgeRows.map(row => ({
      source: String(parseAgtype(row.source)),
      target: String(parseAgtype(row.target)),
      type: 'MENTIONS' as const,
    })),
    ...taggedEdgeRows.map(row => ({
      source: String(parseAgtype(row.source)),
      target: String(parseAgtype(row.target)),
      type: 'TAGGED' as const,
    })),
    ...linksEdgeRows.map(row => ({
      source: String(parseAgtype(row.source)),
      target: String(parseAgtype(row.target)),
      type: 'LINKS' as const,
    })),
  ]

  return {
    nodes: [...conceptNodes, ...noteNodes, ...tagNodes],
    edges,
  }
}

export function toConceptSummaries(
  rows: Array<{ id: string, name: string, description: string | null, mention_count: string | number | bigint }>,
): ConceptSummary[] {
  return rows
    .map(row => ({
      id: row.id,
      name: row.name,
      description: row.description ?? null,
      mentionCount: Number(row.mention_count),
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

  return toConceptSummaries(rows)
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

  return {
    concept: {
      id: concept.id,
      name: concept.name,
      description: concept.description ?? null,
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
