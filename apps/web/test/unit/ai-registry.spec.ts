import { describe, expect, it } from 'vitest'
import { DEFAULT_CHAT_MODEL, DEFAULT_EMBEDDING_MODEL } from '../../server/lib/ai'
import { createEmbeddingProvider, createLLMProvider } from '../../server/lib/ai/registry'

describe('ai registry — createLLMProvider', () => {
  it('defaults to openrouter with the legacy chat model fallback chain', () => {
    const provider = createLLMProvider('agent', {
      NUXT_OPENROUTER_API_KEY: 'sk-test',
      NUXT_OPENROUTER_CHAT_MODEL: 'google/gemma-4-26b-a4b-it:free',
    })
    expect(provider.kind).toBe('openrouter')
    expect(provider.model).toBe('google/gemma-4-26b-a4b-it:free')
  })

  it('prefers the per-use model over the legacy chat model over the default', () => {
    const base = { NUXT_OPENROUTER_API_KEY: 'sk-test' }

    expect(createLLMProvider('agent', { ...base, NUXT_LLM_AGENT_MODEL: 'x/a', NUXT_OPENROUTER_CHAT_MODEL: 'y/b' }).model).toBe('x/a')
    expect(createLLMProvider('agent', { ...base, NUXT_OPENROUTER_CHAT_MODEL: 'y/b' }).model).toBe('y/b')
    expect(createLLMProvider('agent', base).model).toBe(DEFAULT_CHAT_MODEL)

    expect(createLLMProvider('extraction', { ...base, NUXT_LLM_EXTRACTION_MODEL: 'x/c' }).model).toBe('x/c')
    expect(createLLMProvider('extraction', { ...base, NUXT_OPENROUTER_CHAT_MODEL: 'y/d' }).model).toBe('y/d')
    expect(createLLMProvider('extraction', base).model).toBe(DEFAULT_CHAT_MODEL)
  })

  it('agent and extraction resolve independently', () => {
    const agent = createLLMProvider('agent', {
      NUXT_OPENROUTER_API_KEY: 'sk-test',
      NUXT_LLM_AGENT_MODEL: 'agent/model',
      NUXT_LLM_EXTRACTION_MODEL: 'extraction/model',
    })
    const extraction = createLLMProvider('extraction', {
      NUXT_OPENROUTER_API_KEY: 'sk-test',
      NUXT_LLM_AGENT_MODEL: 'agent/model',
      NUXT_LLM_EXTRACTION_MODEL: 'extraction/model',
    })
    expect(agent.model).toBe('agent/model')
    expect(extraction.model).toBe('extraction/model')
  })

  it('builds an ollama provider with its default base url', () => {
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

  it('falls back to the legacy chat model for ollama when set', () => {
    const provider = createLLMProvider('agent', {
      NUXT_LLM_AGENT_PROVIDER: 'ollama',
      NUXT_OPENROUTER_CHAT_MODEL: 'gemma3:4b',
    })
    expect(provider.model).toBe('gemma3:4b')
  })
})

describe('ai registry — createEmbeddingProvider', () => {
  it('defaults to openrouter with the nvidia free model', () => {
    const provider = createEmbeddingProvider({ NUXT_OPENROUTER_API_KEY: 'sk-test' })
    expect(provider.kind).toBe('openrouter')
    expect(provider.model).toBe(DEFAULT_EMBEDDING_MODEL)
  })

  it('resolves the embedding model fallback chain', () => {
    const base = { NUXT_OPENROUTER_API_KEY: 'sk-test' }
    expect(createEmbeddingProvider({ ...base, NUXT_LLM_EMBEDDING_MODEL: 'x/e', NUXT_OPENROUTER_EMBEDDING_MODEL: 'y/e' }).model).toBe('x/e')
    expect(createEmbeddingProvider({ ...base, NUXT_OPENROUTER_EMBEDDING_MODEL: 'y/e' }).model).toBe('y/e')
    expect(createEmbeddingProvider(base).model).toBe(DEFAULT_EMBEDDING_MODEL)
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
})
