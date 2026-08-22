import type { EnvMap, ProviderKind } from '../ai/registry'
import type { EmbeddingProvider, LLMProvider } from '../ai/types'
import type { SyncDb } from '../sync/sweeper'
import process from 'node:process'
import { createEmbeddingProvider, createLLMProvider, resolveEmbeddingProvider, resolveLLMProvider } from '../ai/registry'
import { resolveEmbeddingProviderSettings, resolveLLMProviderSettings } from '../settings'
import { resolveSyncWorkspace } from '../sync/workspace'

interface AgentProviders {
  llm: LLMProvider
  embedding: EmbeddingProvider
  llmProviderInfo: {
    kind: ProviderKind
    model: string
  }
}

export const DEFAULT_AGENT_PROVIDER_INFO: AgentProviders['llmProviderInfo'] = {
  kind: 'openrouter',
  model: 'unknown',
}

let testProviders: AgentProviders | undefined
let agentSingleton: AgentProviders | null = null

export function setAgentTestProviders(providers: Partial<AgentProviders> & { llm: LLMProvider, embedding: EmbeddingProvider }): void {
  testProviders = {
    ...providers,
    llmProviderInfo: {
      ...DEFAULT_AGENT_PROVIDER_INFO,
      model: 'test-model',
      ...providers.llmProviderInfo,
    },
  }
}

export function clearAgentTestProviders(): void {
  testProviders = undefined
}

/**
 * Discard the cached agent providers. The next call to `getAgentProviders`
 * will re-resolve from the current workspace settings and env.
 */
export function clearAgentProviders(): void {
  agentSingleton = null
}

async function createWorkspaceAgentProviders(db: SyncDb, workspaceId?: string, env: EnvMap = process.env): Promise<AgentProviders> {
  const resolvedWorkspaceId = workspaceId ?? await resolveSyncWorkspace(db)
  if (!resolvedWorkspaceId) {
    return createAgentProviders(env)
  }

  const llmSettings = await resolveLLMProviderSettings(db, resolvedWorkspaceId, 'agent', env)
  const embeddingSettings = await resolveEmbeddingProviderSettings(db, resolvedWorkspaceId, env)
  const llmResolved = resolveLLMProvider('agent', env, llmSettings)
  return {
    llm: llmResolved.provider,
    embedding: resolveEmbeddingProvider(env, embeddingSettings).provider,
    llmProviderInfo: { kind: llmResolved.kind, model: llmResolved.model },
  }
}

/**
 * Return cached agent providers, resolving from workspace_settings when a
 * workspace is available. Test providers (set via `setAgentTestProviders`) take
 * precedence and are never cached.
 */
export async function getAgentProviders(db: SyncDb, workspaceId?: string, env: EnvMap = process.env): Promise<AgentProviders> {
  if (testProviders)
    return testProviders

  if (!agentSingleton) {
    agentSingleton = await createWorkspaceAgentProviders(db, workspaceId, env)
  }
  return agentSingleton
}

export function createAgentProviders(env: EnvMap = process.env): AgentProviders {
  if (testProviders)
    return testProviders

  const llmResolved = createLLMProvider('agent', env)
  return {
    llm: llmResolved.provider,
    embedding: createEmbeddingProvider(env).provider,
    llmProviderInfo: { kind: llmResolved.kind, model: llmResolved.model },
  }
}
