import { sql } from 'kysely'

/**
 * Idempotent backfill of the AGE catalog for notes_graph. The e2e template
 * DB is provisioned from db/schema.sql (pg_dump --schema-only), which carries
 * the notes_graph schema + label tables but NOT the catalog rows (catalog
 * data): ag_graph is missing, and so are the two default ag_label rows
 * (_ag_label_vertex id 1, _ag_label_edge id 2). Without the label rows the
 * first MERGE of a new label assigns a colliding label id and segfaults the
 * backend. See the M1/M4 notes in plan-002-system.
 */
export async function ensureNotesGraphCatalog(db: any): Promise<void> {
  await sql`
    INSERT INTO ag_catalog.ag_graph (graphid, name, namespace)
    SELECT n.oid, 'notes_graph', 'notes_graph'
    FROM pg_namespace n
    WHERE n.nspname = 'notes_graph'
      AND NOT EXISTS (SELECT 1 FROM ag_catalog.ag_graph WHERE name = 'notes_graph')
  `.execute(db)

  for (const label of [
    { name: '_ag_label_vertex', id: 1, kind: 'v' },
    { name: '_ag_label_edge', id: 2, kind: 'e' },
  ]) {
    await sql`
      INSERT INTO ag_catalog.ag_label (name, graph, id, kind, relation, seq_name)
      SELECT ${label.name}, g.graphid, ${label.id}, ${label.kind},
             ${`notes_graph.${label.name}`}, ${`${label.name}_id_seq`}
      FROM ag_catalog.ag_graph g
      WHERE g.name = 'notes_graph'
      ON CONFLICT DO NOTHING
    `.execute(db)
  }
}
