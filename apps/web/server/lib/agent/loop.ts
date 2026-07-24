import type { ChatMessage, CompletionRequest, ToolDefinition } from '../ai/types'
import type { AgentContext, AgentEventEmitter, AgentSseEvent, AgentTool } from './types'

export const MAX_AGENT_ITERATIONS = 10

const SYSTEM_PROMPT = `You are a helpful personal knowledge assistant. Ground your answers in the user's own notes, concepts, and sources.

You have access to retrieval tools:
- search_notes: semantic search over note chunks.
- search_concepts: semantic search over extracted concepts.
- get_concept_neighbors: expand a concept in the knowledge graph.
- get_mentions: find note chunks that mention a specific concept.
- read_note: read a full note by path.
- find_paths_between: discover graph paths between two concepts.
- search_sources: search external URLs attached to notes.

Rules:
1. Call tools to gather Context before answering.
2. Always cite the note paths your answer is based on.
3. Be concise; prefer the user's own terminology.
4. If retrieval yields nothing relevant, say so honestly.`

const WRAP_UP_PROMPT = `You have reached the tool-iteration limit. Stop calling tools, summarize what you were able to find, and clearly list anything you could not finish investigating.`

function toToolDefinition(tool: AgentTool): ToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }
}

function emit(event: AgentSseEvent, onEvent: AgentEventEmitter): void {
  onEvent(event)
}

/**
 * Run the agentic tool-calling loop.
 *
 * @returns The final answer text, cited note paths, and the assistant/tool messages generated.
 */
export async function runAgentLoop(
  messages: ChatMessage[],
  tools: AgentTool[],
  ctx: AgentContext,
  onEvent: AgentEventEmitter,
): Promise<{ answer: string, notes: string[], newMessages: ChatMessage[] }> {
  const toolByName = new Map(tools.map(t => [t.name, t]))
  const toolDefinitions = tools.map(toToolDefinition)
  const workingMessages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...messages,
  ]
  const loopMessages: ChatMessage[] = []
  const citedNotes = new Set<string>()

  for (let iteration = 0; iteration < MAX_AGENT_ITERATIONS; iteration++) {
    let result
    try {
      result = await ctx.llm.complete({
        messages: workingMessages,
        tools: toolDefinitions,
        toolChoice: 'auto',
      } as CompletionRequest)
    }
    catch (error) {
      const message = error instanceof Error ? error.message : 'LLM request failed'
      emit({ type: 'error', message }, onEvent)
      return { answer: '', notes: [], newMessages: loopMessages }
    }

    const assistantMessage = result.message
    workingMessages.push(assistantMessage)
    loopMessages.push(assistantMessage)

    if (!assistantMessage.toolCalls || assistantMessage.toolCalls.length === 0) {
      const answer = assistantMessage.content ?? ''
      const notes = [...citedNotes]
      emit({ type: 'answer', text: answer, notes }, onEvent)
      return { answer, notes, newMessages: loopMessages }
    }

    for (const toolCall of assistantMessage.toolCalls) {
      let args: Record<string, unknown>
      try {
        args = JSON.parse(toolCall.arguments) as Record<string, unknown>
      }
      catch {
        const errorResult = { error: `Invalid JSON arguments: ${toolCall.arguments}` }
        emit({ type: 'tool_call', name: toolCall.name, args: { raw: toolCall.arguments }, toolCallId: toolCall.id }, onEvent)
        emit({ type: 'tool_result', name: toolCall.name, result: errorResult, toolCallId: toolCall.id }, onEvent)
        const toolMessage: ChatMessage = { role: 'tool', content: JSON.stringify(errorResult), toolCallId: toolCall.id }
        workingMessages.push(toolMessage)
        loopMessages.push(toolMessage)
        continue
      }

      emit({ type: 'tool_call', name: toolCall.name, args, toolCallId: toolCall.id }, onEvent)

      const tool = toolByName.get(toolCall.name)
      let toolResult: { result: unknown, notes: string[] }
      if (!tool) {
        toolResult = { result: { error: `Unknown tool: ${toolCall.name}` }, notes: [] }
      }
      else {
        try {
          toolResult = await tool.execute(args, ctx)
        }
        catch (error) {
          const message = error instanceof Error ? error.message : 'Tool execution failed'
          toolResult = { result: { error: message }, notes: [] }
        }
      }

      for (const note of toolResult.notes)
        citedNotes.add(note)

      emit({ type: 'tool_result', name: toolCall.name, result: toolResult.result, toolCallId: toolCall.id }, onEvent)
      const toolMessage: ChatMessage = { role: 'tool', content: JSON.stringify(toolResult.result), toolCallId: toolCall.id }
      workingMessages.push(toolMessage)
      loopMessages.push(toolMessage)
    }
  }

  // Iteration cap reached: force a final no-tools completion.
  workingMessages.push({ role: 'system', content: WRAP_UP_PROMPT })
  try {
    const final = await ctx.llm.complete({ messages: workingMessages, toolChoice: 'none' })
    const answer = final.message.content ?? ''
    const finalMessage: ChatMessage = { role: 'assistant', content: answer }
    loopMessages.push(finalMessage)
    const notes = [...citedNotes]
    emit({ type: 'answer', text: answer, notes }, onEvent)
    return { answer, notes, newMessages: loopMessages }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Final LLM request failed'
    emit({ type: 'error', message }, onEvent)
    return { answer: '', notes: [], newMessages: loopMessages }
  }
}
