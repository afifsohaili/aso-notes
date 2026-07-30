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
      const $internal = useRequestFetch()
      const settings = await $internal('/api/settings') as { settings: Record<string, { value: unknown }> }
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
