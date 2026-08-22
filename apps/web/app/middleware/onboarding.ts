export default defineNuxtRouteMiddleware(async (to) => {
  const allowedPaths = ['/login', '/signup', '/settings']
  if (allowedPaths.includes(to.path) || to.path.startsWith('/settings/'))
    return

  const { session } = await useSession()
  if (!session.value)
    return

  const { completed: cached, refresh } = useOnboardingStatus()
  if (cached.value === true)
    return

  let completed: boolean | null

  if (import.meta.server) {
    try {
      // Cast to a plain fetch function to avoid Nuxt/nitropack's generated
      // route-rule type instantiation blowing up TS6's depth limit.
      const $internal = useRequestFetch() as (url: string) => Promise<{ settings: Record<string, { value: unknown }> }>
      const settings = await $internal('/api/settings')
      const value = settings?.settings?.['onboarding.completed_at']?.value
      completed = !!value && typeof value === 'string'
      cached.value = completed
    }
    catch {
      return
    }
  }
  else {
    completed = await refresh()
    if (completed === null)
      return
  }

  if (!completed)
    return navigateTo('/settings', { replace: true })
})
