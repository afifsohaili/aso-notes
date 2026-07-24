import { afterEach, describe, expect, it, vi } from 'vitest'
import { enqueueEmail } from '../../server/lib/email'

describe('enqueueEmail', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('no-ops with a warning when NUXT_REDIS_URL is not set', async () => {
    vi.stubEnv('NUXT_REDIS_URL', '')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(enqueueEmail({
      to: 'user@example.com',
      subject: 'Verify your email address',
      text: 'Click the link',
    })).resolves.toBeUndefined()

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('NUXT_REDIS_URL'))
  })
})
