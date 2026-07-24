import type { AgPropertyValue, GraphDb } from './age'
import { agLiteral, agProperties, executeCypher, NOTES_GRAPH, parseAgtype, queryCypher } from './age'

/**
 * Typed graph-mirror helpers (plan-002-system §AGE graph, mirror rule).
 * Store-graph and UI tag edits call these inside the same transaction as
 * their relational writes. Vertices are MERGEd by their workspace-scoped
 * relational uuid (`id` property); edges carry `workspace_id` for filtering.
 *
 * Single graph (`notes_graph`) for the MVP — every helper accepts an
 * optional `graph` name so per-workspace graphs can come later.
 */

export interface GraphScope {
  graph?: string
}

function graphName(scope?: GraphScope): string {
  return scope?.graph ?? NOTES_GRAPH
}

async function mergeVertex(
  db: GraphDb,
  label: 'Concept' | 'Note' | 'Tag',
  id: string,
  props: Record<string, AgPropertyValue>,
  scope?: GraphScope,
): Promise<void> {
  await executeCypher(
    db,
    `MERGE (n:${label} {id: ${agLiteral(id)}}) SET n += ${agProperties(props)}`,
    graphName(scope),
  )
}

export function mergeConceptNode(
  db: GraphDb,
  node: { id: string, workspaceId: string, name: string },
  scope?: GraphScope,
): Promise<void> {
  return mergeVertex(db, 'Concept', node.id, {
    id: node.id,
    workspace_id: node.workspaceId,
    name: node.name,
  }, scope)
}

export function mergeNoteNode(
  db: GraphDb,
  node: { id: string, workspaceId: string },
  scope?: GraphScope,
): Promise<void> {
  return mergeVertex(db, 'Note', node.id, { id: node.id, workspace_id: node.workspaceId }, scope)
}

export function mergeTagNode(
  db: GraphDb,
  node: { id: string, workspaceId: string, name: string },
  scope?: GraphScope,
): Promise<void> {
  return mergeVertex(db, 'Tag', node.id, {
    id: node.id,
    workspace_id: node.workspaceId,
    name: node.name,
  }, scope)
}

async function mergeEdge(
  db: GraphDb,
  from: { label: string, id: string },
  to: { label: string, id: string },
  type: 'RELATES_TO' | 'MENTIONS' | 'TAGGED' | 'LINKS',
  props: Record<string, AgPropertyValue>,
  scope?: GraphScope,
): Promise<void> {
  const edgeProps = agProperties(props)
  await executeCypher(
    db,
    [
      `MATCH (a:${from.label} {id: ${agLiteral(from.id)}}), (b:${to.label} {id: ${agLiteral(to.id)}})`,
      edgeProps.length > 2
        ? `MERGE (a)-[r:${type} ${edgeProps}]->(b)`
        : `MERGE (a)-[:${type}]->(b)`,
    ].join(' '),
    graphName(scope),
  )
}

/**
 * Concept→Concept edge. One edge per ordered concept pair in AGE (latest
 * type wins); the relational `relations` table keeps every distinct type.
 */
export function mergeRelatesToEdge(
  db: GraphDb,
  edge: { fromId: string, toId: string, type: string, workspaceId: string },
  scope?: GraphScope,
): Promise<void> {
  return mergeEdge(
    db,
    { label: 'Concept', id: edge.fromId },
    { label: 'Concept', id: edge.toId },
    'RELATES_TO',
    { type: edge.type, workspace_id: edge.workspaceId },
    scope,
  )
}

export function mergeMentionsEdge(
  db: GraphDb,
  edge: { noteId: string, conceptId: string, workspaceId: string },
  scope?: GraphScope,
): Promise<void> {
  return mergeEdge(
    db,
    { label: 'Note', id: edge.noteId },
    { label: 'Concept', id: edge.conceptId },
    'MENTIONS',
    { workspace_id: edge.workspaceId },
    scope,
  )
}

export function mergeTaggedEdge(
  db: GraphDb,
  edge: { noteId: string, tagId: string, workspaceId: string },
  scope?: GraphScope,
): Promise<void> {
  return mergeEdge(
    db,
    { label: 'Note', id: edge.noteId },
    { label: 'Tag', id: edge.tagId },
    'TAGGED',
    { workspace_id: edge.workspaceId },
    scope,
  )
}

export function deleteTaggedEdge(
  db: GraphDb,
  edge: { noteId: string, tagId: string, workspaceId: string },
  scope?: GraphScope,
): Promise<void> {
  return executeCypher(
    db,
    [
      `MATCH (n:Note {id: ${agLiteral(edge.noteId)}})-[r:TAGGED]->(t:Tag {id: ${agLiteral(edge.tagId)}})`,
      'DELETE r',
    ].join(' '),
    graphName(scope),
  )
}

export function mergeLinkEdge(
  db: GraphDb,
  edge: { fromNoteId: string, toNoteId: string, workspaceId: string },
  scope?: GraphScope,
): Promise<void> {
  return mergeEdge(
    db,
    { label: 'Note', id: edge.fromNoteId },
    { label: 'Note', id: edge.toNoteId },
    'LINKS',
    { workspace_id: edge.workspaceId },
    scope,
  )
}

/**
 * Wipe every edge incident to a Note node (re-ingestion rewrite). RELATES_TO
 * edges are concept-level and untouched — they're MERGE-deduped instead.
 */
export function wipeNoteEdges(db: GraphDb, noteId: string, scope?: GraphScope): Promise<void> {
  return executeCypher(
    db,
    `MATCH (n:Note {id: ${agLiteral(noteId)}})-[r]-() DELETE r`,
    graphName(scope),
  )
}

export interface ConceptNeighbor {
  id: string
  name: string
  distance: number
}

/**
 * Undirected RELATES_TO neighborhood of a concept, closest first (M5's
 * get_concept_neighbors tool builds on this).
 */
export async function conceptNeighbors(
  db: GraphDb,
  args: { conceptId: string, workspaceId: string, depth?: number },
  scope?: GraphScope,
): Promise<ConceptNeighbor[]> {
  const depth = Math.max(1, Math.floor(args.depth ?? 1))
  const rows = await queryCypher<{ id: unknown, name: unknown, distance: unknown }>(
    db,
    [
      `MATCH p=(a:Concept {id: ${agLiteral(args.conceptId)}})-[r:RELATES_TO*1..${depth}]-(b:Concept)`,
      `WHERE b.workspace_id = ${agLiteral(args.workspaceId)} AND b.id <> a.id`,
      'RETURN b.id, b.name, min(length(p))',
    ].join(' '),
    'id ag_catalog.agtype, name ag_catalog.agtype, distance ag_catalog.agtype',
    graphName(scope),
  )
  return rows
    .map(row => ({
      id: String(parseAgtype(row.id)),
      name: String(parseAgtype(row.name)),
      distance: Number(parseAgtype(row.distance)),
    }))
    .sort((a, b) => a.distance - b.distance)
}
