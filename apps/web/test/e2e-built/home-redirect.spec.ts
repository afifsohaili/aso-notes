import type { Kysely } from 'kysely'
import { withBuiltServer } from '@base/testing/built-server'
import { createFileDatabase } from '@base/testing/transaction'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

describe('home redirect and removed boilerplate routes', () => {
  let db: Kysely<Database>
  let baseUrl: string
  let cookies: string

  beforeAll(async () => {
    db = createFileDatabase()
    const server = await withBuiltServer()
    baseUrl = server.baseUrl

    const email = `home-redirect-${Date.now()}@example.com`
    const password = 'TestPassword123!'

    const signupRes = await fetch(`${baseUrl}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Origin': baseUrl },
      body: JSON.stringify({ email, password, name: 'Home Redirect Tester' }),
    })
    const signupBody = (await signupRes.json()) as { user?: { id: string } }
    const userId = signupBody?.user?.id
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

  it('redirects signed-out users from / to /login', async () => {
    const res = await fetch(`${baseUrl}/`, { redirect: 'manual' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/login')
  })

  it('redirects signed-in users from / to /chat', async () => {
    const res = await fetch(`${baseUrl}/`, {
      redirect: 'manual',
      headers: { cookie: cookies },
    })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/chat')
  })

  it('returns 404 for removed /admin', async () => {
    const res = await fetch(`${baseUrl}/admin`, { redirect: 'manual' })
    expect(res.status).toBe(404)
  })

  it('returns 404 for removed /admin/notifications', async () => {
    const res = await fetch(`${baseUrl}/admin/notifications`, { redirect: 'manual' })
    expect(res.status).toBe(404)
  })

  it('returns 404 for removed /dashboard/notifications', async () => {
    const res = await fetch(`${baseUrl}/dashboard/notifications`, { redirect: 'manual' })
    expect(res.status).toBe(404)
  })

  it('returns 404 for removed /articles/hello-world', async () => {
    const res = await fetch(`${baseUrl}/articles/hello-world`, { redirect: 'manual' })
    expect(res.status).toBe(404)
  })

  it('returns 404 for removed /api/todos', async () => {
    const res = await fetch(`${baseUrl}/api/todos`, { redirect: 'manual' })
    expect(res.status).toBe(404)
  })

  it('returns 404 for removed /api/notifications', async () => {
    const res = await fetch(`${baseUrl}/api/notifications`, { redirect: 'manual' })
    expect(res.status).toBe(404)
  })

  it('returns 404 for removed /api/admin/notifications', async () => {
    const res = await fetch(`${baseUrl}/api/admin/notifications`, { redirect: 'manual' })
    expect(res.status).toBe(404)
  })
})
