import type { AgentTool, AgentToolResult } from '../types'

export const READ_NOTE_TOOL_NAME = 'read_note'

export const readNoteTool: AgentTool = {
  name: READ_NOTE_TOOL_NAME,
  description: 'Read the full content of a note by its workspace-relative path. Use when the user asks about a specific note or when another tool points to a note you need to inspect.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Workspace-relative note path, e.g. "/projects/ideas.md".',
      },
    },
    required: ['path'],
    additionalProperties: false,
  },
  async execute(args, ctx): Promise<AgentToolResult> {
    const path = String(args.path ?? '').trim()
    if (!path)
      return { result: { error: 'path is required' }, notes: [] }

    const note = await ctx.db
      .selectFrom('notes')
      .select(['id', 'path', 'title', 'content'])
      .where('workspace_id', '=', ctx.workspaceId)
      .where('path', '=', path)
      .executeTakeFirst()

    if (!note)
      return { result: { notFound: true, path }, notes: [] }

    return {
      result: {
        note: {
          path: note.path,
          title: note.title,
          content: note.content ?? '',
        },
      },
      notes: [note.path],
    }
  },
}
