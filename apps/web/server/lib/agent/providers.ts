import type { EmbeddingProvider, LLMProvider } from '../ai'
import type { EnvMap } from '../ai/registry'
import process from 'node:process'
import { createEmbeddingProvider, createLLMProvider } from '../ai/registry'

interface AgentProviders {
  llm: LLMProvider
  embedding: EmbeddingProvider
}

let testProviders: AgentProviders | undefined

export function setAgentTestProviders(providers: AgentProviders): void {
  testProviders = providers
}

export function clearAgentTestProviders(): void {
  testProviders = undefined
}

export function createAgentProviders(env: EnvMap = process.env): AgentProviders {
  if (testProviders)
    return testProviders

  return {
    llm: createLLMProvider('agent', env).provider,
    embedding: createEmbeddingProvider(env).provider,
  }
}
