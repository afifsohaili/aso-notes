import process from 'node:process'
import type { H3Event } from 'h3'

export interface RuntimeConfig {
  databaseUrl: string
  betterAuthSecret?: string
  public: {
    siteUrl?: string
    turnstileSiteKey?: string
  }
}

const fallbackConfig: RuntimeConfig = {
  databaseUrl: process.env.NUXT_DATABASE_URL || process.env.DATABASE_URL || '',
  betterAuthSecret: process.env.NUXT_BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET,
  public: {
    siteUrl: process.env.NUXT_PUBLIC_SITE_URL,
    turnstileSiteKey: process.env.NUXT_PUBLIC_TURNSTILE_SITE_KEY,
  },
}

export function useRuntimeConfig(event?: H3Event): RuntimeConfig {
  const fromEvent = (event as any)?.context?.runtimeConfig as RuntimeConfig | undefined
  if (fromEvent)
    return fromEvent
  return fallbackConfig
}
