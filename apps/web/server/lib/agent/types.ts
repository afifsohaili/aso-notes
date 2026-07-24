import type { DB } from '@monorepo/shared'
import type { Kysely, Transaction } from 'kysely'
import type { EmbeddingProvider, LLMProvider } from '../ai/types'

/** Database handle used by agent tools. */
export type AgentDb = Kysely<DB> | Transaction<DB>

/** Context shared with every tool invocation. */
export interface AgentContext {
  workspaceId: string
  db: AgentDb
  llm: LLMProvider
  embedding: EmbeddingProvider
}

/** A tool the agent can call to retrieve Context. */
export interface AgentTool {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute: (args: Record<string, unknown>, ctx: AgentContext) => Promise<AgentToolResult>
}

/** Result returned by a tool: the LLM-facing payload plus cited note paths. */
export interface AgentToolResult {
  /** JSON-serializable value shown to the LLM. */
  result: unknown
  /** Note paths cited by this result (used to build the final answer's citation list). */
  notes: string[]
}

/** SSE event emitted during the agent loop. */
export type AgentSseEvent
  = | ToolCallSseEvent
    | ToolResultSseEvent
    | AnswerSseEvent
    | ErrorSseEvent

export interface ToolCallSseEvent {
  type: 'tool_call'
  name: string
  args: Record<string, unknown>
  toolCallId?: string
}

export interface ToolResultSseEvent {
  type: 'tool_result'
  name: string
  result: unknown
  toolCallId?: string
}

export interface AnswerSseEvent {
  type: 'answer'
  text: string
  notes: string[]
}

export interface ErrorSseEvent {
  type: 'error'
  message: string
}

/** Function signature for emitting SSE events from the loop. */
export type AgentEventEmitter = (event: AgentSseEvent) => void

/** Result returned by runAgent after the loop finishes. */
export interface AgentRunResult {
  answer: string
  notes: string[]
  conversationId: string
}
