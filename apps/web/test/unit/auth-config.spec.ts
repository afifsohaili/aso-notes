import { describe, expect, it, vi } from 'vitest'

vi.mock('../../utils/db', () => ({
  useDatabase: vi.fn(() => ({})),
}))

vi.mock('../../server/lib/email', () => ({
  enqueueEmail: vi.fn(),
}))

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365
const ONE_DAY_SECONDS = 60 * 60 * 24

describe('auth config', () => {
  it('uses a 1-year expiry with a daily rolling update', async () => {
    const { useAuth } = await import('../../utils/auth')

    const auth = useAuth({ databaseUrl: 'postgres://fake' })

    expect(auth.options.session).toMatchObject({
      expiresIn: ONE_YEAR_SECONDS,
      updateAge: ONE_DAY_SECONDS,
    })
  })
})
