import type { PipelineContext } from '../context'
import type { ExtractedLink, Stage } from '../types'
import { EXTRACT_LINKS_STAGE } from '../ids'
import { parseNoteLinks } from '../links'

/**
 * Parse wikilinks + internal markdown links from the note's raw content and
 * resolve each target to a note id by path (plan §data model `links`:
 * dangling links keep raw_target and are re-resolved on the next ingestion).
 * Writes ExtractedLink[] to ctx output 'links'; store-graph persists them.
 */
export class ExtractLinksStage implements Stage {
  readonly id = EXTRACT_LINKS_STAGE

  async invoke(ctx: PipelineContext): Promise<void> {
    const parsed = parseNoteLinks(ctx.note.content ?? '', ctx.note.path)
    if (parsed.length === 0) {
      ctx.setOutput<ExtractedLink[]>('links', [])
      return
    }

    const candidates = [...new Set(parsed.flatMap(link => link.candidates))]
    const rows = await ctx.db
      .selectFrom('notes')
      .select(['id', 'path'])
      .where('workspace_id', '=', ctx.workspaceId)
      .where('path', 'in', candidates)
      .execute()
    const idByPath = new Map(rows.map(row => [row.path, row.id]))

    const links: ExtractedLink[] = parsed.map(link => ({
      rawTarget: link.rawTarget,
      toNoteId: link.candidates.reduce<string | null>(
        (found, candidate) => found ?? idByPath.get(candidate) ?? null,
        null,
      ),
    }))
    ctx.setOutput('links', links)
  }
}
