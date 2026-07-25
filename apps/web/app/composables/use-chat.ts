import type { ChatSseEvent } from '~/utils/chat-sse'
import { readChatSseEvents } from '~/utils/chat-sse'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  notes?: string[]
  isError?: boolean
}

export interface ChatActivity {
  toolCallId: string
  name: string
  args: Record<string, unknown>
  result?: unknown
}

export function useChat() {
  const messages = ref<ChatMessage[]>([])
  const activities = ref<ChatActivity[]>([])
  const isStreaming = ref(false)
  const error = ref<string | null>(null)
  const currentConversationId = ref<string | null>(null)

  function reset() {
    messages.value = []
    activities.value = []
    isStreaming.value = false
    error.value = null
    currentConversationId.value = null
  }

  function addMessage(message: ChatMessage) {
    messages.value.push(message)
  }

  function loadMessages(history: Array<{ role: string, content: string | null }>) {
    messages.value = history
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({
        id: crypto.randomUUID(),
        role: m.role as 'user' | 'assistant',
        content: m.content ?? '',
      }))
  }

  async function sendQuery(query: string, conversationId?: string) {
    isStreaming.value = true
    error.value = null
    activities.value = []
    addMessage({ id: crypto.randomUUID(), role: 'user', content: query })

    try {
      const response = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, conversationId }),
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
      const message = err instanceof Error ? err.message : 'Agent run failed'
      error.value = message
    }
    finally {
      isStreaming.value = false
    }
  }

  function handleEvent(event: ChatSseEvent) {
    switch (event.type) {
      case 'tool_call': {
        activities.value.push({
          toolCallId: event.toolCallId,
          name: event.name,
          args: event.args,
        })
        break
      }
      case 'tool_result': {
        const activity = activities.value.find(a => a.toolCallId === event.toolCallId)
        if (activity)
          activity.result = event.result
        break
      }
      case 'answer': {
        currentConversationId.value = event.conversationId
        addMessage({
          id: crypto.randomUUID(),
          role: 'assistant',
          content: event.text,
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
    reset,
    loadMessages,
  }
}
