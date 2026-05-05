import { useAuth } from '~~/utils/auth'

export default defineEventHandler(async (event) => {
  const url = getRequestURL(event)

  // Only process API routes, skip BetterAuth routes (they handle their own auth)
  if (!url.pathname.startsWith('/api/') || url.pathname.startsWith('/api/auth/'))
    return

  try {
    const auth = useAuth(useRuntimeConfig(event))
    const session = await auth.api.getSession({
      headers: event.headers,
    })

    if (session?.user) {
      event.context.user = session.user
      event.context.session = session.session
    }
  }
  catch {
    // Silently ignore auth errors in middleware
    // Individual endpoints will handle missing auth
  }
})
