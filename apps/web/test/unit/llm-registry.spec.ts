import type { EnvMap, ResolvedProviderSettings } from '../../server/lib/ai/registry'
import { describe, expect, it } from 'vitest'
import {
  createEmbeddingProvider,
  createLLMProvider,
  DEFAULT_CHAT_MODEL,
  DEFAULT_EMBEDDING_MODEL,
  OLLAMA_BASE_URL,
  OPENROUTER_BASE_URL,
  resolveEmbeddingProvider,
  resolveLLMProvider,
} from '../../server/lib/ai/registry'

function env(overrides: Record<string, string | undefined> = {}): EnvMap {
  return { ...overrides }
}

describe('resolveLLMProvider', () => {
  it('uses workspace settings over env values', () => {
    const settings: ResolvedProviderSettings = {
      provider: 'ollama',
      model: 'gemma3:4b',
      base_url: 'http://custom:11434',
    }
    const resolved = resolveLLMProvider('agent', env({
      NUXT_LLM_AGENT_PROVIDER: 'openrouter',
      NUXT_LLM_AGENT_MODEL: 'deepseek/deepseek-v4-flash',
      NUXT_LLM_AGENT_BASE_URL: 'https://openrouter.example',
      NUXT_LLM_AGENT_API_KEY: 'env-key',
    }), settings)

    expect(resolved.kind).toBe('ollama')
    expect(resolved.model).toBe('gemma3:4b')
    expect(resolved.baseUrl).toBe('http://custom:11434')
  })

  it('falls back to env when workspace settings are absent', () => {
    const resolved = resolveLLMProvider('extraction', env({
      NUXT_LLM_EXTRACTION_PROVIDER: 'ollama',
      NUXT_LLM_EXTRACTION_MODEL: 'qwen2.5:7b',
      NUXT_LLM_EXTRACTION_BASE_URL: 'http://ollama:11434',
    }))

    expect(resolved.kind).toBe('ollama')
    expect(resolved.model).toBe('qwen2.5:7b')
    expect(resolved.baseUrl).toBe('http://ollama:11434')
  })

  it('falls back to openrouter code defaults when neither workspace nor env set model', () => {
    const resolved = resolveLLMProvider('agent', env({
      NUXT_LLM_AGENT_API_KEY: 'env-key',
    }))

    expect(resolved.kind).toBe('openrouter')
    expect(resolved.model).toBe(DEFAULT_CHAT_MODEL)
    expect(resolved.baseUrl).toBe(OPENROUTER_BASE_URL)
  })

  it('uses env provider default when only env model is absent', () => {
    const resolved = resolveLLMProvider('extraction', env({
      NUXT_LLM_EXTRACTION_PROVIDER: 'openrouter',
      NUXT_LLM_EXTRACTION_API_KEY: 'env-key',
    }))

    expect(resolved.kind).toBe('openrouter')
    expect(resolved.model).toBe(DEFAULT_CHAT_MODEL)
  })

  it('requires an explicit model for ollama', () => {
    expect(() => resolveLLMProvider('agent', env({ NUXT_LLM_AGENT_PROVIDER: 'ollama' })))
      .toThrow('NUXT_LLM_AGENT_MODEL is required')
  })

  it('requires an openrouter api key', () => {
    expect(() => resolveLLMProvider('agent', env({ NUXT_LLM_AGENT_PROVIDER: 'openrouter' })))
      .toThrow('NUXT_LLM_AGENT_API_KEY is required')
  })

  it('allows a partial workspace settings override of model only', () => {
    const resolved = resolveLLMProvider('agent', env({
      NUXT_LLM_AGENT_PROVIDER: 'openrouter',
      NUXT_LLM_AGENT_API_KEY: 'env-key',
    }), { model: 'custom/model' })

    expect(resolved.kind).toBe('openrouter')
    expect(resolved.model).toBe('custom/model')
    expect(resolved.baseUrl).toBe(OPENROUTER_BASE_URL)
  })
})

describe('resolveEmbeddingProvider', () => {
  it('uses workspace settings over env values', () => {
    const settings: ResolvedProviderSettings = {
      provider: 'ollama',
      model: 'nomic-embed-text',
      base_url: 'http://custom:11434',
    }
    const resolved = resolveEmbeddingProvider(env({
      NUXT_LLM_EMBEDDING_PROVIDER: 'openrouter',
      NUXT_LLM_EMBEDDING_MODEL: 'openai/text-embedding-3-small',
      NUXT_LLM_EMBEDDING_BASE_URL: 'https://openrouter.example',
      NUXT_LLM_EMBEDDING_API_KEY: 'env-key',
    }), settings)

    expect(resolved.kind).toBe('ollama')
    expect(resolved.model).toBe('nomic-embed-text')
    expect(resolved.baseUrl).toBe('http://custom:11434')
  })

  it('falls back to env when workspace settings are absent', () => {
    const resolved = resolveEmbeddingProvider(env({
      NUXT_LLM_EMBEDDING_PROVIDER: 'ollama',
      NUXT_LLM_EMBEDDING_MODEL: 'nomic-embed-text',
    }))

    expect(resolved.kind).toBe('ollama')
    expect(resolved.model).toBe('nomic-embed-text')
    expect(resolved.baseUrl).toBe(OLLAMA_BASE_URL)
  })

  it('falls back to openrouter code defaults when neither workspace nor env set model', () => {
    const resolved = resolveEmbeddingProvider(env({
      NUXT_LLM_EMBEDDING_API_KEY: 'env-key',
    }))

    expect(resolved.kind).toBe('openrouter')
    expect(resolved.model).toBe(DEFAULT_EMBEDDING_MODEL)
    expect(resolved.baseUrl).toBe(OPENROUTER_BASE_URL)
  })

  it('requires an explicit model for ollama', () => {
    expect(() => resolveEmbeddingProvider(env({ NUXT_LLM_EMBEDDING_PROVIDER: 'ollama' })))
      .toThrow('NUXT_LLM_EMBEDDING_MODEL is required')
  })

  it('requires an openrouter api key', () => {
    expect(() => resolveEmbeddingProvider(env({ NUXT_LLM_EMBEDDING_PROVIDER: 'openrouter' })))
      .toThrow('NUXT_LLM_EMBEDDING_API_KEY is required')
  })
})

describe('createLLMProvider / createEmbeddingProvider', () => {
  it('remain env-only shorthands for tests and direct usage', () => {
    const llm = createLLMProvider('agent', env({
      NUXT_LLM_AGENT_PROVIDER: 'openrouter',
      NUXT_LLM_AGENT_API_KEY: 'env-key',
    }))
    const embedding = createEmbeddingProvider(env({
      NUXT_LLM_EMBEDDING_PROVIDER: 'openrouter',
      NUXT_LLM_EMBEDDING_API_KEY: 'env-key',
    }))

    expect(llm.kind).toBe('openrouter')
    expect(llm.model).toBe(DEFAULT_CHAT_MODEL)
    expect(embedding.kind).toBe('openrouter')
    expect(embedding.model).toBe(DEFAULT_EMBEDDING_MODEL)
  })
})
