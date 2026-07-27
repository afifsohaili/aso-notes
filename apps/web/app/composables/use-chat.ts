import type { ChatSseEvent } from '~/utils/chat-sse'
import { readChatSseEvents } from '~/utils/chat-sse'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  notes?: string[]
  isError?: boolean
  /** True when id is a real DB id (loaded from the server) — editable */
  persisted?: boolean
}

export interface ChatActivity {
  toolCallId: string
  name: string
  args: Record<string, unknown>
  result?: unknown
  status: 'pending' | 'done'
}

export interface ConversationHistoryMessage {
  id: string
  role: string
  content: string | null
  tool_calls: unknown
  tool_call_id: string | null
}

interface PersistedToolCall {
  id: string
  name: string
  arguments: string
}

function summarizeResult(result: unknown): string {
  if (result && typeof result === 'object') {
    for (const [key, value] of Object.entries(result as Record<string, unknown>)) {
      if (Array.isArray(value))
        return `${value.length} ${key}`
    }
    if ('notFound' in (result as Record<string, unknown>))
      return 'not found'
  }
  return 'done'
}

export function useChat() {
  const messages = ref<ChatMessage[]>([])
  const activities = ref<ChatActivity[]>([])
  const isStreaming = ref(false)
  const error = ref<string | null>(null)
  const currentConversationId = ref<string | null>(null)

  let abortController: AbortController | null = null

  function reset() {
    cancel()
    messages.value = []
    activities.value = []
    error.value = null
    currentConversationId.value = null
  }

  function addMessage(message: ChatMessage) {
    messages.value.push(message)
  }

  /**
   * Load a persisted conversation. Tool-call assistant messages (null content)
   * are not rendered as bubbles — instead they (plus their tool-result
   * messages) are reconstructed into the activity log so past runs stay
   * observable. Assistant citations (`notes`) from the current session are
   * preserved by content match.
   */
  function loadMessages(history: ConversationHistoryMessage[]) {
    const notesByContent = new Map<string, string[]>()
    for (const m of messages.value) {
      if (m.role === 'assistant' && m.notes?.length)
        notesByContent.set(m.content, m.notes)
    }

    const resultsByToolCallId = new Map<string, unknown>()
    for (const m of history) {
      if (m.role === 'tool' && m.tool_call_id && m.content) {
        try {
          resultsByToolCallId.set(m.tool_call_id, JSON.parse(m.content))
        }
        catch {
          resultsByToolCallId.set(m.tool_call_id, m.content)
        }
      }
    }

    const newActivities: ChatActivity[] = []
    for (const m of history) {
      if (m.role !== 'assistant' || !m.tool_calls)
        continue
      const toolCalls = m.tool_calls as PersistedToolCall[]
      for (const tc of toolCalls) {
        let args: Record<string, unknown> = {}
        try {
          args = JSON.parse(tc.arguments)
        }
        catch { /* keep empty */ }
        const result = resultsByToolCallId.get(tc.id)
        newActivities.push({
          toolCallId: tc.id,
          name: tc.name,
          args,
          result,
          status: result === undefined ? 'pending' : 'done',
        })
      }
    }
    activities.value = newActivities

    messages.value = history
      .filter(m => (m.role === 'user' || m.role === 'assistant') && m.content)
      .map(m => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content as string,
        notes: notesByContent.get(m.content as string),
        persisted: true,
      }))
  }

  async function sendQuery(query: string, options?: { conversationId?: string, editFromMessageId?: string }) {
    cancel()
    abortController = new AbortController()
    isStreaming.value = true
    error.value = null
    activities.value = []

    if (options?.editFromMessageId) {
      const index = messages.value.findIndex(m => m.id === options.editFromMessageId)
      if (index >= 0)
        messages.value = messages.value.slice(0, index)
    }

    addMessage({ id: crypto.randomUUID(), role: 'user', content: query })

    try {
      const response = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          conversationId: options?.conversationId,
          editFromMessageId: options?.editFromMessageId,
        }),
        signal: abortController.signal,
      })

      if (!response.ok) {
        const text = await response.text()
        let message = text || `Request failed with ${response.status}`
        try {
          const parsed = JSON.parse(text) as { message?: string, statusMessage?: string }
          if (parsed.message || parsed.statusMessage)
            message = parsed.message || parsed.statusMessage || message
        }
        catch {
          // keep raw text
        }
        throw new Error(message)
      }

      if (!response.body)
        throw new Error('Response body is empty')

      const reader = response.body.getReader()
      let answerReceived = false

      for await (const event of readChatSseEvents(reader)) {
        handleEvent(event)
        if (event.type === 'answer')
          answerReceived = true
      }

      if (!answerReceived && !error.value)
        throw new Error('Stream ended without an answer')
    }
    catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError')
        return
      const message = err instanceof Error ? err.message : 'Agent run failed'
      error.value = message
    }
    finally {
      isStreaming.value = false
      abortController = null
    }
  }

  function cancel() {
    abortController?.abort()
    abortController = null
    isStreaming.value = false
  }

  function handleEvent(event: ChatSseEvent) {
    switch (event.type) {
      case 'tool_call': {
        activities.value.push({
          toolCallId: event.toolCallId,
          name: event.name,
          args: event.args,
          status: 'pending',
        })
        break
      }
      case 'tool_result': {
        const activity = activities.value.find(a => a.toolCallId === event.toolCallId)
        if (activity) {
          activity.result = event.result
          activity.status = 'done'
        }
        break
      }
      case 'answer': {
        currentConversationId.value = event.conversationId
        addMessage({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: event.text ?? '',
          notes: event.notes,
        })
        break
      }
      case 'error': {
        error.value = event.message
        break
      }
    }
  }

  return {
    messages,
    activities,
    isStreaming,
    error,
    currentConversationId,
    sendQuery,
    cancel,
    reset,
    loadMessages,
    summarizeResult,
  }
}
