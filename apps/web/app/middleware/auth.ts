export default defineNuxtRouteMiddleware(async () => {
  const { session } = await useSession()
  if (!session.value) {
    return navigateTo('/login')
  }
})
