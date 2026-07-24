import type { PipelineContext } from '../context'
import type { Stage } from '../types'
import { sql } from 'kysely'
import { RESOLVE_COVERS_STAGE } from '../ids'

/**
 * Maximum number of folder levels in the cover chain, counting the note's
 * own folder as level 1 (plan §resolve-covers: "4-level cap").
 */
export const MAX_COVER_CHAIN_DEPTH = 4

interface ChainRow {
  path: string
  cover_content: string | null
  depth: number
}

/** dirname of a note/folder path in the path-string model ('/a/b' → '/a', '/a' → '/'). */
function parentPath(path: string): string {
  if (path === '/')
    return '/'
  const parent = path.replace(/\/[^/]+$/, '')
  return parent === '' ? '/' : parent
}

/**
 * Merge the nearest-ancestor folder covers into ctx.coverChain, root→leaf.
 * Folders are a path-string model (no parent_id), so the ancestor walk trims
 * one path segment per recursion step, capped at MAX_COVER_CHAIN_DEPTH levels.
 */
export class ResolveCoversStage implements Stage {
  readonly id = RESOLVE_COVERS_STAGE

  async invoke(ctx: PipelineContext): Promise<void> {
    const startPath = await this.resolveStartPath(ctx)
    if (!startPath)
      return

    const { rows } = await sql<ChainRow>`
      WITH RECURSIVE chain AS (
        SELECT f.path, f.cover_content, 0 AS depth
        FROM folders f
        WHERE f.workspace_id = ${ctx.workspaceId}
          AND f.path = ${startPath}
        UNION ALL
        SELECT p.path, p.cover_content, c.depth + 1
        FROM folders p
        JOIN chain c
          ON p.workspace_id = ${ctx.workspaceId}
         AND c.path <> '/'
         AND p.path = CASE
           WHEN position('/' IN substring(c.path FROM 2)) = 0 THEN '/'
           ELSE regexp_replace(c.path, '/[^/]+$', '')
         END
        WHERE c.depth < ${MAX_COVER_CHAIN_DEPTH - 1}
      )
      SELECT path, cover_content, depth FROM chain ORDER BY depth DESC
    `.execute(ctx.db)

    const covers = rows
      .map(row => row.cover_content)
      .filter((cover): cover is string => typeof cover === 'string' && cover.length > 0)

    if (covers.length > 0)
      ctx.coverChain = covers.join('\n\n')
  }

  /**
   * Where the ancestor walk starts: the note's folder when folder_id is set,
   * otherwise the folder implied by the note's own path (root notes → '/').
   */
  private async resolveStartPath(ctx: PipelineContext): Promise<string | null> {
    if (ctx.note.folder_id) {
      const folder = await ctx.db
        .selectFrom('folders')
        .select('path')
        .where('id', '=', ctx.note.folder_id)
        .where('workspace_id', '=', ctx.workspaceId)
        .executeTakeFirst()
      // A dangling folder_id (folder deleted, SET NULL raced) falls back to the path.
      if (folder)
        return folder.path
    }
    return parentPath(ctx.note.path)
  }
}
