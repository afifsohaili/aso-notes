import type { ChatMessage, ChatRole } from '../ai/types'
import type { TraceStatus } from '../observability/trace-writer'
import type { AgentContext, AgentLoopTraceOptions, AgentRunResult, AgentSseEvent, AgentTool, AgentToolResult } from './types'
import { appendToolCall, createSeqCounter, createTrace, finishTrace, safeTraceWrite } from '../observability/trace-writer'
import { TracedLLMProvider } from '../observability/traced-provider'
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

/**
 * Edit-previous-message: delete the target user message and everything after
 * it in the conversation, so the new query replaces that turn. The target
 * must belong to this conversation and workspace.
 */
async function truncateFromMessage(
  ctx: AgentContext,
  conversationId: string,
  messageId: string,
): Promise<void> {
  const target = await ctx.db
    .selectFrom('messages')
    .select(['created_at'])
    .where('id', '=', messageId)
    .where('conversation_id', '=', conversationId)
    .where('workspace_id', '=', ctx.workspaceId)
    .executeTakeFirst()

  if (!target)
    throw new Error(`Message ${messageId} not found in conversation ${conversationId}`)

  await ctx.db
    .deleteFrom('messages')
    .where('conversation_id', '=', conversationId)
    .where('workspace_id', '=', ctx.workspaceId)
    .where('created_at', '>=', target.created_at)
    .execute()
}

async function persistLoopMessages(
  ctx: AgentContext,
  conversationId: string,
  messages: ChatMessage[],
  traceId?: string,
): Promise<void> {
  if (messages.length === 0)
    return

  // The final assistant answer is the last assistant message without tool calls.
  let answerIndex = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'assistant' && !messages[i]!.toolCalls) {
      answerIndex = i
      break
    }
  }

  const values = messages.map((message, index) => ({
    workspace_id: ctx.workspaceId,
    conversation_id: conversationId,
    role: message.role,
    content: message.content,
    tool_calls: message.toolCalls ? JSON.stringify(message.toolCalls) : null,
    tool_call_id: message.toolCallId ?? null,
    trace_id: traceId && index === answerIndex ? traceId : null,
  }))

  await ctx.db.insertInto('messages').values(values).execute()
}

export interface RunAgentOptions {
  conversationId?: string
  editFromMessageId?: string
  query: string
  signal?: AbortSignal
}

function buildTracedContext(ctx: AgentContext): AgentContext {
  const provider = ctx.llmProviderInfo?.kind ?? 'openrouter'
  const model = ctx.llmProviderInfo?.model ?? 'unknown'
  return {
    ...ctx,
    llm: new TracedLLMProvider(ctx.llm, { db: ctx.db, provider, model, llmUseCase: 'agent' }),
  }
}

function wrapTool(tool: AgentTool, trace: AgentLoopTraceOptions): AgentTool {
  return {
    ...tool,
    async execute(args, ctx) {
      const start = Date.now()
      let result: AgentToolResult
      let status = 'completed'
      try {
        result = await tool.execute(args, ctx)
      }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        result = { result: { error: message }, notes: [] }
        status = 'failed'
      }
      const duration = Date.now() - start
      safeTraceWrite('appendToolCall', () => appendToolCall(ctx.db, {
        workspaceId: trace.workspaceId,
        traceId: trace.traceId,
        seq: trace.nextSeq(),
        name: tool.name,
        input: args,
        output: result.result,
        durationMs: duration,
        status,
      }))
      return result
    },
  }
}

export async function runAgent(
  options: RunAgentOptions,
  ctx: AgentContext,
  tools: AgentTool[],
  onEvent: (event: AgentSseEvent) => void,
): Promise<AgentRunResult> {
  const conversation = await loadOrCreateConversation(ctx, options.conversationId, options.query)

  if (options.editFromMessageId)
    await truncateFromMessage(ctx, conversation.id, options.editFromMessageId)

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

  const traceId = await safeTraceWrite('createTrace', () => createTrace(ctx.db, {
    workspaceId: ctx.workspaceId,
    kind: 'chat',
    ownerType: 'conversations',
    ownerId: conversation.id,
  }))

  let trace: AgentLoopTraceOptions | undefined
  let finishStatus: TraceStatus = 'completed'
  let finishError: string | null = null
  let loopCtx = ctx
  let loopTools = tools
  if (traceId) {
    const nextSeq = createSeqCounter()
    const traceOptions: AgentLoopTraceOptions = {
      traceId,
      workspaceId: ctx.workspaceId,
      useCase: 'agent',
      nextSeq,
    }
    trace = traceOptions
    loopCtx = buildTracedContext(ctx)
    loopTools = tools.map(t => wrapTool(t, traceOptions))
  }

  try {
    const { answer, notes, newMessages } = await runAgentLoop(
      inputMessages,
      loopTools,
      loopCtx,
      e => onEvent(wrapEvent(e)),
      trace,
      options.signal,
    )
    await persistLoopMessages(ctx, conversation.id, newMessages, traceId)

    if (options.signal?.aborted) {
      finishStatus = 'aborted'
      finishError = null
    }

    return {
      answer,
      notes,
      conversationId: conversation.id,
    }
  }
  catch (error) {
    finishStatus = 'failed'
    finishError = error instanceof Error ? error.message : String(error)
    throw error
  }
  finally {
    if (traceId) {
      await safeTraceWrite('finishTrace', () => finishTrace(ctx.db, { traceId, status: finishStatus, error: finishError }))
    }
  }
}
