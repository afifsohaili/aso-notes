import type { H3Event } from 'h3'

const runtimeConfig = {
  databaseUrl: process.env.NUXT_DATABASE_URL || process.env.DATABASE_URL || '',
}

export function useRuntimeConfig(event?: H3Event) {
  return (event as any)?.context?.runtimeConfig || runtimeConfig
}
