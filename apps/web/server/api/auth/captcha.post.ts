export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const body = await readBody(event)
  const { token } = body

  if (!token) {
    throw createError({
      statusCode: 400,
      message: 'Turnstile token is required',
    })
  }

  if (!config.turnstileSecretKey?.length) {
    return {}
  }

  try {
    const formData = new URLSearchParams()
    formData.append('secret', config.turnstileSecretKey)
    formData.append('response', token)

    const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      body: formData,
      method: 'POST',
    })

    const outcome = await result.json()

    if (!outcome.success) {
      throw createError({
        statusCode: 400,
        message: 'Turnstile validation failed',
      })
    }

    return { success: true }
  }
  catch {
    throw createError({
      statusCode: 500,
      message: 'Failed to validate Turnstile token',
    })
  }
})
