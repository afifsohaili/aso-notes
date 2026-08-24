import type { OllamaEmbeddingProvider, OllamaLLMProvider, OmlxEmbeddingProvider, OmlxLLMProvider, OpenRouterEmbeddingProvider, OpenRouterLLMProvider } from '../../server/lib/ai'
import { describe, expect, it } from 'vitest'
import { DEFAULT_CHAT_MODEL, DEFAULT_EMBEDDING_MODEL, OMLX_BASE_URL } from '../../server/lib/ai'
import { createEmbeddingProvider, createLLMProvider, resolveEmbeddingProvider, resolveLLMProvider } from '../../server/lib/ai/registry'

describe('ai registry — createLLMProvider', () => {
  it('defaults to openrouter with the provider default model', () => {
    const provider = createLLMProvider('agent', {
      NUXT_LLM_AGENT_API_KEY: 'sk-test',
    })
    expect(provider.kind).toBe('openrouter')
    expect(provider.model).toBe(DEFAULT_CHAT_MODEL)
  })

  it('uses the per-use model when set, independently per use', () => {
    const agent = createLLMProvider('agent', {
      NUXT_LLM_AGENT_API_KEY: 'sk-a',
      NUXT_LLM_AGENT_MODEL: 'agent/model',
      NUXT_LLM_EXTRACTION_MODEL: 'extraction/model',
    })
    const extraction = createLLMProvider('extraction', {
      NUXT_LLM_EXTRACTION_API_KEY: 'sk-b',
      NUXT_LLM_AGENT_MODEL: 'agent/model',
      NUXT_LLM_EXTRACTION_MODEL: 'extraction/model',
    })
    expect(agent.model).toBe('agent/model')
    expect(extraction.model).toBe('extraction/model')
  })

  it('requires the per-use api key for openrouter', () => {
    expect(() => createLLMProvider('agent', {})).toThrow(/NUXT_LLM_AGENT_API_KEY/)
    expect(() => createLLMProvider('extraction', {})).toThrow(/NUXT_LLM_EXTRACTION_API_KEY/)
  })

  it('builds an ollama provider with its default base url and no api key', () => {
    const provider = createLLMProvider('agent', {
      NUXT_LLM_AGENT_PROVIDER: 'ollama',
      NUXT_LLM_AGENT_MODEL: 'gemma3:4b',
    })
    expect(provider.kind).toBe('ollama')
    expect(provider.model).toBe('gemma3:4b')
    expect(provider.baseUrl).toBe('http://localhost:11434')
  })

  it('honours a per-use base url override', () => {
    const provider = createLLMProvider('extraction', {
      NUXT_LLM_EXTRACTION_PROVIDER: 'ollama',
      NUXT_LLM_EXTRACTION_BASE_URL: 'http://192.168.1.10:11434',
      NUXT_LLM_EXTRACTION_MODEL: 'gemma3:4b',
    })
    expect(provider.baseUrl).toBe('http://192.168.1.10:11434')
  })

  it('throws a clear error when ollama has no model configured', () => {
    expect(() => createLLMProvider('agent', { NUXT_LLM_AGENT_PROVIDER: 'ollama' }))
      .toThrow(/NUXT_LLM_AGENT_MODEL/)
  })

  it('builds an omlx provider with its default base url and no api key', () => {
    const provider = createLLMProvider('agent', {
      NUXT_LLM_AGENT_PROVIDER: 'omlx',
      NUXT_LLM_AGENT_MODEL: 'mlx-community/llama-3.2-3b',
    })
    expect(provider.kind).toBe('omlx')
    expect(provider.model).toBe('mlx-community/llama-3.2-3b')
    expect(provider.baseUrl).toBe('http://localhost:8000/v1')
  })

  it('passes the env api key to omlx providers', () => {
    const provider = createLLMProvider('agent', {
      NUXT_LLM_AGENT_PROVIDER: 'omlx',
      NUXT_LLM_AGENT_MODEL: 'mlx-community/llama-3.2-3b',
      NUXT_LLM_AGENT_API_KEY: 'omlx-secret',
    })
    expect(provider.kind).toBe('omlx')
    expect((provider.provider as OmlxLLMProvider).apiKey).toBe('omlx-secret')
  })

  it('honours an omlx base url override', () => {
    const provider = createLLMProvider('extraction', {
      NUXT_LLM_EXTRACTION_PROVIDER: 'omlx',
      NUXT_LLM_EXTRACTION_BASE_URL: 'http://192.168.1.5:8000/v1',
      NUXT_LLM_EXTRACTION_MODEL: 'mlx-community/llama-3.2-3b',
    })
    expect(provider.baseUrl).toBe('http://192.168.1.5:8000/v1')
  })

  it('throws a clear error when omlx has no model configured', () => {
    expect(() => createLLMProvider('agent', { NUXT_LLM_AGENT_PROVIDER: 'omlx' }))
      .toThrow(/NUXT_LLM_AGENT_MODEL/)
  })
})

describe('ai registry — createEmbeddingProvider', () => {
  it('defaults to openrouter with the nvidia free model', () => {
    const provider = createEmbeddingProvider({
      NUXT_LLM_EMBEDDING_API_KEY: 'sk-test',
    })
    expect(provider.kind).toBe('openrouter')
    expect(provider.model).toBe(DEFAULT_EMBEDDING_MODEL)
  })

  it('requires the embedding api key for openrouter', () => {
    expect(() => createEmbeddingProvider({})).toThrow(/NUXT_LLM_EMBEDDING_API_KEY/)
  })

  it('builds an ollama embedding provider', () => {
    const provider = createEmbeddingProvider({
      NUXT_LLM_EMBEDDING_PROVIDER: 'ollama',
      NUXT_LLM_EMBEDDING_MODEL: 'nomic-embed-text',
    })
    expect(provider.kind).toBe('ollama')
    expect(provider.model).toBe('nomic-embed-text')
    expect(provider.baseUrl).toBe('http://localhost:11434')
  })

  it('throws a clear error when ollama embedding has no model configured', () => {
    expect(() => createEmbeddingProvider({ NUXT_LLM_EMBEDDING_PROVIDER: 'ollama' }))
      .toThrow(/NUXT_LLM_EMBEDDING_MODEL/)
  })

  it('builds an omlx embedding provider with its default base url and no api key', () => {
    const provider = createEmbeddingProvider({
      NUXT_LLM_EMBEDDING_PROVIDER: 'omlx',
      NUXT_LLM_EMBEDDING_MODEL: 'mlx-community/all-MiniLM-L6-v2',
    })
    expect(provider.kind).toBe('omlx')
    expect(provider.model).toBe('mlx-community/all-MiniLM-L6-v2')
    expect(provider.baseUrl).toBe('http://localhost:8000/v1')
  })

  it('passes the env api key to omlx embedding providers', () => {
    const provider = createEmbeddingProvider({
      NUXT_LLM_EMBEDDING_PROVIDER: 'omlx',
      NUXT_LLM_EMBEDDING_MODEL: 'mlx-community/all-MiniLM-L6-v2',
      NUXT_LLM_EMBEDDING_API_KEY: 'omlx-secret',
    })
    expect(provider.kind).toBe('omlx')
    expect((provider.provider as OmlxEmbeddingProvider).apiKey).toBe('omlx-secret')
  })

  it('honours an omlx embedding base url override', () => {
    const provider = createEmbeddingProvider({
      NUXT_LLM_EMBEDDING_PROVIDER: 'omlx',
      NUXT_LLM_EMBEDDING_BASE_URL: 'http://192.168.1.5:8000/v1',
      NUXT_LLM_EMBEDDING_MODEL: 'mlx-community/all-MiniLM-L6-v2',
    })
    expect(provider.baseUrl).toBe('http://192.168.1.5:8000/v1')
  })

  it('throws a clear error when omlx embedding has no model configured', () => {
    expect(() => createEmbeddingProvider({ NUXT_LLM_EMBEDDING_PROVIDER: 'omlx' }))
      .toThrow(/NUXT_LLM_EMBEDDING_MODEL/)
  })
})

describe('ai registry — resilience options', () => {
  it('uses default resilience options for agent', () => {
    const resolved = createLLMProvider('agent', { NUXT_LLM_AGENT_API_KEY: 'sk' })
    const provider = resolved.provider as OpenRouterLLMProvider
    expect(provider.resilience).toEqual({ timeoutMs: 60000, maxAttempts: 4, baseDelayMs: 1000 })
  })

  it('reads per-use timeout and attempt env vars', () => {
    const resolved = createLLMProvider('extraction', {
      NUXT_LLM_EXTRACTION_API_KEY: 'sk',
      NUXT_LLM_EXTRACTION_TIMEOUT_MS: '120000',
      NUXT_LLM_EXTRACTION_MAX_ATTEMPTS: '2',
      NUXT_LLM_EXTRACTION_BASE_DELAY_MS: '500',
    })
    const provider = resolved.provider as OpenRouterLLMProvider
    expect(provider.resilience).toEqual({ timeoutMs: 120000, maxAttempts: 2, baseDelayMs: 500 })
  })

  it('passes resilience options to ollama providers', () => {
    const resolved = createLLMProvider('agent', {
      NUXT_LLM_AGENT_PROVIDER: 'ollama',
      NUXT_LLM_AGENT_MODEL: 'gemma3:4b',
      NUXT_LLM_AGENT_TIMEOUT_MS: '30000',
      NUXT_LLM_AGENT_MAX_ATTEMPTS: '5',
    })
    const provider = resolved.provider as OllamaLLMProvider
    expect(provider.resilience).toEqual({ timeoutMs: 30000, maxAttempts: 5, baseDelayMs: 1000 })
  })

  it('passes resilience options to the embedding provider', () => {
    const resolved = createEmbeddingProvider({
      NUXT_LLM_EMBEDDING_API_KEY: 'sk',
      NUXT_LLM_EMBEDDING_TIMEOUT_MS: '90000',
      NUXT_LLM_EMBEDDING_MAX_ATTEMPTS: '3',
      NUXT_LLM_EMBEDDING_BASE_DELAY_MS: '2000',
    })
    const provider = resolved.provider as OpenRouterEmbeddingProvider
    expect(provider.resilience).toEqual({ timeoutMs: 90000, maxAttempts: 3, baseDelayMs: 2000 })
  })

  it('passes resilience options to the ollama embedding provider', () => {
    const resolved = createEmbeddingProvider({
      NUXT_LLM_EMBEDDING_PROVIDER: 'ollama',
      NUXT_LLM_EMBEDDING_MODEL: 'nomic-embed-text',
      NUXT_LLM_EMBEDDING_TIMEOUT_MS: '45000',
      NUXT_LLM_EMBEDDING_MAX_ATTEMPTS: '6',
      NUXT_LLM_EMBEDDING_BASE_DELAY_MS: '750',
    })
    const provider = resolved.provider as OllamaEmbeddingProvider
    expect(provider.resilience).toEqual({ timeoutMs: 45000, maxAttempts: 6, baseDelayMs: 750 })
  })

  it('passes resilience env vars to omlx llm providers', () => {
    const resolved = createLLMProvider('agent', {
      NUXT_LLM_AGENT_PROVIDER: 'omlx',
      NUXT_LLM_AGENT_MODEL: 'mlx-community/llama-3.2-3b',
      NUXT_LLM_AGENT_TIMEOUT_MS: '45000',
      NUXT_LLM_AGENT_MAX_ATTEMPTS: '7',
      NUXT_LLM_AGENT_BASE_DELAY_MS: '300',
    })
    const provider = resolved.provider as OmlxLLMProvider
    expect(provider.resilience).toEqual({ timeoutMs: 45000, maxAttempts: 7, baseDelayMs: 300 })
  })

  it('passes resilience env vars to omlx embedding providers', () => {
    const resolved = createEmbeddingProvider({
      NUXT_LLM_EMBEDDING_PROVIDER: 'omlx',
      NUXT_LLM_EMBEDDING_MODEL: 'mlx-community/all-MiniLM-L6-v2',
      NUXT_LLM_EMBEDDING_TIMEOUT_MS: '60000',
      NUXT_LLM_EMBEDDING_MAX_ATTEMPTS: '4',
      NUXT_LLM_EMBEDDING_BASE_DELAY_MS: '250',
    })
    const provider = resolved.provider as OmlxEmbeddingProvider
    expect(provider.resilience).toEqual({ timeoutMs: 60000, maxAttempts: 4, baseDelayMs: 250 })
  })

  it('settings provider override beats env for omlx llm', () => {
    const resolved = resolveLLMProvider('agent', {
      NUXT_LLM_AGENT_PROVIDER: 'openrouter',
      NUXT_LLM_AGENT_MODEL: 'deepseek/deepseek-v4-flash',
      NUXT_LLM_AGENT_API_KEY: 'env-key',
    }, { provider: 'omlx', model: 'mlx-community/llama-3.2-3b' })

    expect(resolved.kind).toBe('omlx')
    expect(resolved.model).toBe('mlx-community/llama-3.2-3b')
    expect(resolved.baseUrl).toBe(OMLX_BASE_URL)
  })

  it('settings provider override beats env for omlx embedding', () => {
    const resolved = resolveEmbeddingProvider({
      NUXT_LLM_EMBEDDING_PROVIDER: 'openrouter',
      NUXT_LLM_EMBEDDING_MODEL: 'openai/text-embedding-3-small',
      NUXT_LLM_EMBEDDING_API_KEY: 'env-key',
    }, { provider: 'omlx', model: 'mlx-community/all-MiniLM-L6-v2' })

    expect(resolved.kind).toBe('omlx')
    expect(resolved.model).toBe('mlx-community/all-MiniLM-L6-v2')
    expect(resolved.baseUrl).toBe(OMLX_BASE_URL)
  })
})
