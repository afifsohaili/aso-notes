import { AGENT_TOOLS, runAgent } from '~~/server/lib/agent'
import { createAgentProviders } from '~~/server/lib/agent/providers'
import { useDatabase } from '~~/utils/db'

export default defineEventHandler(async (event) => {
  if (!event.context.user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const body = await readBody(event)
  const query = typeof body?.query === 'string' ? body.query.trim() : ''
  if (!query) {
    throw createError({ statusCode: 400, statusMessage: 'query is required' })
  }

  const config = useRuntimeConfig(event)
  const db = useDatabase(config)

  const membership = await db
    .selectFrom('memberships')
    .select('workspace_id')
    .where('user_id', '=', event.context.user.id)
    .orderBy('created_at', 'asc')
    .executeTakeFirst()

  if (!membership) {
    throw createError({ statusCode: 400, statusMessage: 'No workspace found for user' })
  }

  const workspaceId = membership.workspace_id

  const { llm, embedding } = createAgentProviders()

  setResponseHeader(event, 'content-type', 'text/event-stream')
  setResponseHeader(event, 'cache-control', 'no-cache, no-transform')
  setResponseHeader(event, 'connection', 'keep-alive')

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const onEvent = (e: { type: string }) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`))
      }

      try {
        await runAgent(
          {
            query,
            conversationId: body?.conversationId,
            editFromMessageId: typeof body?.editFromMessageId === 'string' ? body.editFromMessageId : undefined,
          },
          { workspaceId, db, llm, embedding },
          AGENT_TOOLS,
          onEvent,
        )
      }
      catch (error) {
        const message = error instanceof Error ? error.message : 'Agent run failed'
        onEvent({ type: 'error', message })
      }
      finally {
        controller.close()
      }
    },
  })

  return stream
})
