import process from 'node:process'
import { KEYS } from '../../../lib/ai/registry'

// Per-role provider availability for the settings UI (Phase 4 onboarding).
export default defineEventHandler(async (event) => {
  if (!event.context.user) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }

  const env = process.env

  function roleAvailability(role: 'agent' | 'extraction' | 'embedding') {
    const apiKey = env[KEYS[role].apiKey]
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
    },
  }
})
