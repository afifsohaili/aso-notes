import type { ChatMessage, ChatRole } from '../ai/types'
import type { AgentContext, AgentRunResult, AgentSseEvent, AgentTool } from './types'
import { runAgentLoop } from './loop'

interface MessageRow {
  id: string
  role: string
  content: string | null
  tool_calls: unknown
  tool_call_id: string | null
}

function mapDbMessageToChatMessage(row: MessageRow): ChatMessage {
  return {
    role: row.role as ChatRole,
    content: row.content,
    toolCalls: row.tool_calls
      ? (row.tool_calls as Array<{ id: string, name: string, arguments: string }>).map(tc => ({
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
        }))
      : undefined,
    toolCallId: row.tool_call_id ?? undefined,
  }
}

function titleFromQuery(query: string): string {
  return query.trim().slice(0, 60)
}

async function loadOrCreateConversation(
  ctx: AgentContext,
  conversationId: string | undefined,
  query: string,
): Promise<{ id: string, isNew: boolean }> {
  if (conversationId) {
    const existing = await ctx.db
      .selectFrom('conversations')
      .select('id')
      .where('id', '=', conversationId)
      .where('workspace_id', '=', ctx.workspaceId)
      .executeTakeFirst()

    if (!existing)
      throw new Error(`Conversation ${conversationId} not found`)

    return { id: existing.id, isNew: false }
  }

  const created = await ctx.db
    .insertInto('conversations')
    .values({
      workspace_id: ctx.workspaceId,
      title: titleFromQuery(query),
    })
    .returning('id')
    .executeTakeFirstOrThrow()

  return { id: created.id, isNew: true }
}

async function loadPriorMessages(ctx: AgentContext, conversationId: string): Promise<ChatMessage[]> {
  const rows = await ctx.db
    .selectFrom('messages')
    .select(['id', 'role', 'content', 'tool_calls', 'tool_call_id'])
    .where('conversation_id', '=', conversationId)
    .where('workspace_id', '=', ctx.workspaceId)
    .orderBy('created_at', 'asc')
    .execute()

  return rows.map(mapDbMessageToChatMessage)
}

async function persistUserMessage(
  ctx: AgentContext,
  conversationId: string,
  query: string,
): Promise<void> {
  await ctx.db
    .insertInto('messages')
    .values({
      workspace_id: ctx.workspaceId,
      conversation_id: conversationId,
      role: 'user',
      content: query,
      tool_calls: null,
      tool_call_id: null,
    })
    .execute()
}

async function persistLoopMessages(
  ctx: AgentContext,
  conversationId: string,
  messages: ChatMessage[],
): Promise<void> {
  if (messages.length === 0)
    return

  const values = messages.map(message => ({
    workspace_id: ctx.workspaceId,
    conversation_id: conversationId,
    role: message.role,
    content: message.content,
    tool_calls: message.toolCalls ? JSON.stringify(message.toolCalls) : null,
    tool_call_id: message.toolCallId ?? null,
  }))

  await ctx.db.insertInto('messages').values(values).execute()
}

export interface RunAgentOptions {
  conversationId?: string
  query: string
}

export async function runAgent(
  options: RunAgentOptions,
  ctx: AgentContext,
  tools: AgentTool[],
  onEvent: (event: AgentSseEvent) => void,
): Promise<AgentRunResult> {
  const conversation = await loadOrCreateConversation(ctx, options.conversationId, options.query)
  const priorMessages = conversation.isNew ? [] : await loadPriorMessages(ctx, conversation.id)

  await persistUserMessage(ctx, conversation.id, options.query)

  const inputMessages: ChatMessage[] = [
    ...priorMessages,
    { role: 'user', content: options.query },
  ]

  const wrapEvent = (event: AgentSseEvent): AgentSseEvent => {
    if (event.type === 'answer')
      return { ...event, conversationId: conversation.id }
    return event
  }

  const { answer, notes, newMessages } = await runAgentLoop(inputMessages, tools, ctx, e => onEvent(wrapEvent(e)))
  await persistLoopMessages(ctx, conversation.id, newMessages)

  return {
    answer,
    notes,
    conversationId: conversation.id,
  }
}
