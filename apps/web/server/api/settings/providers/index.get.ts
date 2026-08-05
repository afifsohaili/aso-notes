import process from 'node:process'
import { KEYS } from '../../../lib/ai/registry'

// Per-role provider availability for the settings UI (Phase 4 onboarding).
export default defineEventHandler(async (event) => {
  if (!event.context.user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const env = process.env

  function roleAvailability(role: 'agent' | 'extraction' | 'embedding' | 'consolidation') {
    let apiKey = env[KEYS[role].apiKey]
    // Consolidation has no dedicated key requirement: it falls back to the
    // extraction role's config, so its availability follows extraction.
    if (role === 'consolidation' && (!apiKey || apiKey.length === 0))
      apiKey = env[KEYS.extraction.apiKey]
    return {
      openrouter: typeof apiKey === 'string' && apiKey.length > 0,
      ollama: true,
    }
  }

  return {
    providers: {
      agent: roleAvailability('agent'),
      extraction: roleAvailability('extraction'),
      embedding: roleAvailability('embedding'),
      consolidation: roleAvailability('consolidation'),
    },
  }
})
