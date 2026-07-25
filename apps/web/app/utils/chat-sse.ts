export type ChatSseEvent = ToolCallEvent | ToolResultEvent | AnswerEvent | ErrorEvent

export interface ToolCallEvent {
  type: 'tool_call'
  name: string
  args: Record<string, unknown>
  toolCallId: string
}

export interface ToolResultEvent {
  type: 'tool_result'
  name: string
  result: unknown
  toolCallId: string
}

export interface AnswerEvent {
  type: 'answer'
  text: string
  notes: string[]
  conversationId: string
}

export interface ErrorEvent {
  type: 'error'
  message: string
}

function parseEventBlock(block: string): ChatSseEvent | undefined {
  const dataLines: string[] = []
  for (const rawLine of block.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart())
    }
  }

  if (dataLines.length === 0)
    return undefined

  const payload = dataLines.join('\n')
  try {
    return JSON.parse(payload) as ChatSseEvent
  }
  catch {
    return undefined
  }
}

export async function* readChatSseEvents(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<ChatSseEvent> {
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done)
      break

    buffer += decoder.decode(value, { stream: true })

    for (let boundary = buffer.indexOf('\n\n'); boundary !== -1; boundary = buffer.indexOf('\n\n')) {
      const block = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      const event = parseEventBlock(block)
      if (event)
        yield event
    }
  }

  const trailing = buffer.trim()
  if (trailing) {
    const event = parseEventBlock(trailing)
    if (event)
      yield event
  }
}
