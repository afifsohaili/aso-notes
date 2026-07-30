import type { Kysely } from 'kysely'
import { withBuiltServer } from '@base/testing/built-server'
import { createFileDatabase } from '@base/testing/transaction'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

describe('onboarding gate', () => {
  let db: Kysely<Database>
  let baseUrl: string
  let cookies: string
  let userId: string

  beforeAll(async () => {
    db = createFileDatabase()
    const server = await withBuiltServer()
    baseUrl = server.baseUrl

    const email = `onboarding-gate-${Date.now()}@example.com`
    const password = 'TestPassword123!'

    const signupRes = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Origin': baseUrl },
      body: JSON.stringify({ email, password, name: 'Onboarding Gate Tester' }),
    })
    const signupBody = (await signupRes.json()) as { user?: { id: string } }
    userId = signupBody?.user?.id ?? ''
    if (!userId)
      throw new Error(`sign-up failed: ${JSON.stringify(signupBody)}`)

    await db.updateTable('users').set({ emailVerified: true }).where('id', '=', userId).execute()

    const loginRes = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Origin': baseUrl },
      body: JSON.stringify({ email, password }),
    })
    const text = await loginRes.text()
    if (!loginRes.ok)
      throw new Error(`sign-in failed: ${text}`)
    const setCookies = loginRes.headers.getSetCookie?.() ?? []
    cookies = setCookies.map(c => c.split(';')[0]).join('; ')
  })

  afterAll(async () => {
    await db.destroy()
  })

  async function gatedPageRedirects(path: string) {
    const res = await fetch(`${baseUrl}${path}`, {
      redirect: 'manual',
      headers: { cookie: cookies },
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/settings')
  }

  it('allows /settings while onboarding is incomplete', async () => {
    const res = await fetch(`${baseUrl}/settings`, {
      redirect: 'manual',
      headers: { cookie: cookies },
    })
    expect(res.status).toBe(200)
  })

  it('redirects /chat to /settings when onboarding is incomplete', () => gatedPageRedirects('/chat'))
  it('redirects /notes to /settings when onboarding is incomplete', () => gatedPageRedirects('/notes'))
  it('redirects /graph to /settings when onboarding is incomplete', () => gatedPageRedirects('/graph'))
  it('redirects /notes/queue to /settings when onboarding is incomplete', () => gatedPageRedirects('/notes/queue'))

  it('lets app pages load once onboarding is complete', async () => {
    const completeRes = await fetch(`${baseUrl}/api/settings`, {
      method: 'PATCH',
      headers: { 'cookie': cookies, 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'onboarding.completed_at', value: '2026-07-30T12:00:00.000Z' }),
    })
    expect(completeRes.status).toBe(200)

    for (const path of ['/chat', '/notes', '/graph', '/notes/queue']) {
      const res = await fetch(`${baseUrl}${path}`, {
        redirect: 'manual',
        headers: { cookie: cookies },
      })
      expect(res.status, `${path} should load after onboarding completes`).toBe(200)
    }
  })
})
