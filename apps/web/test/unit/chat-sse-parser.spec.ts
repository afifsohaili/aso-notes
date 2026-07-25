import type { ChatSseEvent } from '../../app/utils/chat-sse'
import { describe, expect, it } from 'vitest'
import { readChatSseEvents } from '../../app/utils/chat-sse'

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let i = 0
  return new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close()
        return
      }
      controller.enqueue(encoder.encode(chunks[i]))
      i++
    },
  })
}

async function collectEvents(chunks: string[]): Promise<ChatSseEvent[]> {
  const reader = streamFromChunks(chunks).getReader()
  const events: ChatSseEvent[] = []
  for await (const event of readChatSseEvents(reader)) {
    events.push(event)
  }
  return events
}

describe('readChatSseEvents', () => {
  it('parses all four event types from one chunk', async () => {
    const text = [
      'data: {"type":"tool_call","name":"search_notes","args":{"query":"x"},"toolCallId":"c1"}',
      '',
      'data: {"type":"tool_result","name":"search_notes","result":{"count":1},"toolCallId":"c1"}',
      '',
      'data: {"type":"answer","text":"hello","notes":["/a.md"],"conversationId":"conv-1"}',
      '',
      'data: {"type":"error","message":"boom"}',
      '',
    ].join('\n')

    const events = await collectEvents([text])

    expect(events).toHaveLength(4)
    expect(events[0]).toEqual({ type: 'tool_call', name: 'search_notes', args: { query: 'x' }, toolCallId: 'c1' })
    expect(events[1]).toEqual({ type: 'tool_result', name: 'search_notes', result: { count: 1 }, toolCallId: 'c1' })
    expect(events[2]).toEqual({ type: 'answer', text: 'hello', notes: ['/a.md'], conversationId: 'conv-1' })
    expect(events[3]).toEqual({ type: 'error', message: 'boom' })
  })

  it('reassembles a frame split across getReader chunks', async () => {
    const frame = 'data: {"type":"answer","text":"split","notes":[],"conversationId":"conv-2"}\n\n'
    const splitAt = 18
    const events = await collectEvents([frame.slice(0, splitAt), frame.slice(splitAt)])

    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ type: 'answer', text: 'split', notes: [], conversationId: 'conv-2' })
  })

  it('splits multiple events that arrive in one chunk', async () => {
    const text = [
      'data: {"type":"tool_call","name":"a","args":{},"toolCallId":"1"}',
      '',
      'data: {"type":"tool_call","name":"b","args":{},"toolCallId":"2"}',
      '',
    ].join('\n')

    const events = await collectEvents([text])

    expect(events).toHaveLength(2)
    expect(events[0]!.name).toBe('a')
    expect(events[1]!.name).toBe('b')
  })

  it('tolerates malformed and non-data lines', async () => {
    const text = [
      ':keep-alive',
      '',
      'data: {"type":"answer","text":"ok","notes":[],"conversationId":"conv-3"}',
      'ignored garbage',
      '',
      'data: not valid json',
      '',
      'data: {"type":"tool_call","name":"x","args":{},"toolCallId":"3"}',
      '',
    ].join('\n')

    const events = await collectEvents([text])

    expect(events).toHaveLength(2)
    expect(events[0]).toEqual({ type: 'answer', text: 'ok', notes: [], conversationId: 'conv-3' })
    expect(events[1]).toEqual({ type: 'tool_call', name: 'x', args: {}, toolCallId: '3' })
  })

  it('ignores an incomplete frame without terminating double newline', async () => {
    const events = await collectEvents(['data: {"type":"answer","text":"never"'])

    expect(events).toHaveLength(0)
  })
})
