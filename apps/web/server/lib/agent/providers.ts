import type { AiEnv, EmbeddingProvider, LLMProvider } from '../ai'
import { createEmbeddingProviderFromEnv, createLLMProviderFromEnv } from '../ai'

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

export function createAgentProviders(env: AiEnv): AgentProviders {
  if (testProviders)
    return testProviders

  return {
    llm: createLLMProviderFromEnv(env),
    embedding: createEmbeddingProviderFromEnv(env),
  }
}
