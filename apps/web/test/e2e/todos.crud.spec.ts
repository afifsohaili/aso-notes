import { readFileSync } from 'node:fs'
import { fetch, setup } from '@nuxt/test-utils/e2e'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Load .env for direct DB access in test process
const envFile = readFileSync(new URL('../../.env', import.meta.url), 'utf-8')
for (const line of envFile.split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/)
  if (match) {
    const key = match[1].trim()
    const value = match[2].trim().replace(/^["']|["']$/g, '')
    if (!process.env[key])
      process.env[key] = value
  }
}

describe('Todo CRUD API', async () => {
  await setup({
    host: process.env.TEST_HOST,
  })

  const testEmail = `test-todo-${Date.now()}@example.com`
  let cookies = ''
  let userId = ''
  let todoIds: number[] = []

  const pool = new pg.Pool({
    connectionString: process.env.NUXT_DATABASE_URL || process.env.DATABASE_URL,
  })

  beforeAll(async () => {
    const origin = process.env.TEST_HOST || 'http://localhost:3000'

    // Sign up a test user via BetterAuth
    const res = await fetch('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Origin': origin },
      body: JSON.stringify({
        name: 'Test Todo User',
        email: testEmail,
        password: 'TestPassword123!',
      }),
    })

    const body = await res.json()
    userId = body?.user?.id

    if (!userId) {
      throw new Error(`Sign-up failed: ${JSON.stringify(body)}`)
    }

    // Verify email
    await pool.query('UPDATE users SET "emailVerified" = true WHERE id = $1', [userId])

    // Sign in to get cookies
    const signInRes = await fetch('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Origin': origin },
      body: JSON.stringify({
        email: testEmail,
        password: 'TestPassword123!',
      }),
    })
    const setCookies = signInRes.headers.getSetCookie?.() ?? []
    cookies = setCookies.map(c => c.split(';')[0]).join('; ')

    // Seed a test todo
    const { rows } = await pool.query(
      'INSERT INTO todos (user_id, title, description, completed) VALUES ($1, $2, $3, $4) RETURNING id',
      [userId, 'Seeded Todo', 'A test todo', false],
    )
    todoIds = rows.map((r: any) => r.id)
  })

  afterAll(async () => {
    if (todoIds.length > 0) {
      await pool.query('DELETE FROM todos WHERE id = ANY($1::int[])', [todoIds])
    }
    if (userId) {
      await pool.query('DELETE FROM sessions WHERE "userId" = $1', [userId])
      await pool.query('DELETE FROM accounts WHERE "userId" = $1', [userId])
      await pool.query('DELETE FROM memberships WHERE user_id = $1', [userId])
      await pool.query('DELETE FROM users WHERE id = $1', [userId])
    }
    await pool.end()
  })

  // ─── GET /api/todos ───
  it('GET returns 401 when not authenticated', async () => {
    const res = await fetch('/api/todos')
    expect(res.status).toBe(401)
  })

  it('GET returns 200 with todos array for authenticated user', async () => {
    const res = await fetch('/api/todos', {
      headers: { cookie: cookies },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBeGreaterThan(0)
    expect(body[0]).toHaveProperty('title')
    expect(body[0]).toHaveProperty('completed')
  })

  it('GET only returns todos belonging to the authenticated user', async () => {
    const res = await fetch('/api/todos', {
      headers: { cookie: cookies },
    })
    const body = await res.json()
    for (const todo of body) {
      expect(todo.user_id).toBe(userId)
    }
  })

  it('GET returns todos ordered by created_at descending', async () => {
    const res = await fetch('/api/todos', {
      headers: { cookie: cookies },
    })
    const body = await res.json()
    if (body.length >= 2) {
      const dates = body.map((t: any) => new Date(t.created_at).getTime())
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i - 1]).toBeGreaterThanOrEqual(dates[i])
      }
    }
  })

  // ─── POST /api/todos ───
  it('POST returns 401 when not authenticated', async () => {
    const res = await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Unauthorized' }),
    })
    expect(res.status).toBe(401)
  })

  it('POST creates a new todo and returns 201', async () => {
    const res = await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: cookies },
      body: JSON.stringify({
        title: 'Buy groceries',
        description: 'Milk, eggs, bread',
      }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.title).toBe('Buy groceries')
    expect(body.description).toBe('Milk, eggs, bread')
    expect(body.completed).toBe(false)
    expect(body.user_id).toBe(userId)
    if (body.id) todoIds.push(body.id)
  })

  it('POST returns 400 when title is missing', async () => {
    const res = await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: cookies },
      body: JSON.stringify({ description: 'No title here' }),
    })
    expect(res.status).toBe(400)
  })

  it('POST returns 400 when title is empty string', async () => {
    const res = await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: cookies },
      body: JSON.stringify({ title: '' }),
    })
    expect(res.status).toBe(400)
  })

  // ─── PUT /api/todos/[id] ───
  it('PUT returns 401 when not authenticated', async () => {
    const res = await fetch(`/api/todos/${todoIds[0]}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Hacked' }),
    })
    expect(res.status).toBe(401)
  })

  it('PUT updates a todo and returns 200', async () => {
    const res = await fetch(`/api/todos/${todoIds[0]}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie: cookies },
      body: JSON.stringify({
        title: 'Updated Todo Title',
        completed: true,
      }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.title).toBe('Updated Todo Title')
    expect(body.completed).toBe(true)
  })

  it('PUT returns 404 for non-existent todo', async () => {
    const res = await fetch('/api/todos/999999', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie: cookies },
      body: JSON.stringify({ title: 'Ghost' }),
    })
    expect(res.status).toBe(404)
  })

  it('PUT returns 403 when updating another users todo', async () => {
    // Create another user and their todo
    const otherEmail = `test-other-${Date.now()}@example.com`
    const origin = process.env.TEST_HOST || 'http://localhost:3000'

    const signupRes = await fetch('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Origin': origin },
      body: JSON.stringify({
        name: 'Other User',
        email: otherEmail,
        password: 'TestPassword123!',
      }),
    })
    const otherBody = await signupRes.json()
    const otherUserId = otherBody?.user?.id
    if (!otherUserId) throw new Error('Failed to create other user')

    await pool.query('UPDATE users SET "emailVerified" = true WHERE id = $1', [otherUserId])

    const { rows } = await pool.query(
      'INSERT INTO todos (user_id, title, description, completed) VALUES ($1, $2, $3, $4) RETURNING id',
      [otherUserId, 'Other user todo', 'Not mine', false],
    )
    const otherTodoId = rows[0].id

    // Try to update other user's todo with our cookies
    const res = await fetch(`/api/todos/${otherTodoId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie: cookies },
      body: JSON.stringify({ title: 'Hacked' }),
    })
    expect(res.status).toBe(403)

    // Cleanup other user
    await pool.query('DELETE FROM todos WHERE id = $1', [otherTodoId])
    await pool.query('DELETE FROM sessions WHERE "userId" = $1', [otherUserId])
    await pool.query('DELETE FROM accounts WHERE "userId" = $1', [otherUserId])
    await pool.query('DELETE FROM memberships WHERE user_id = $1', [otherUserId])
    await pool.query('DELETE FROM users WHERE id = $1', [otherUserId])
  })

  // ─── DELETE /api/todos/[id] ───
  it('DELETE returns 401 when not authenticated', async () => {
    const res = await fetch(`/api/todos/${todoIds[0]}`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(401)
  })

  it('DELETE removes a todo and returns 200', async () => {
    // Create a todo to delete
    const { rows } = await pool.query(
      'INSERT INTO todos (user_id, title, description, completed) VALUES ($1, $2, $3, $4) RETURNING id',
      [userId, 'Todo to delete', 'Temporary', false],
    )
    const deleteId = rows[0].id
    todoIds.push(deleteId)

    const res = await fetch(`/api/todos/${deleteId}`, {
      method: 'DELETE',
      headers: { cookie: cookies },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)

    // Verify it's gone
    const { rows: checkRows } = await pool.query('SELECT id FROM todos WHERE id = $1', [deleteId])
    expect(checkRows.length).toBe(0)
  })

  it('DELETE returns 404 for non-existent todo', async () => {
    const res = await fetch('/api/todos/999999', {
      method: 'DELETE',
      headers: { cookie: cookies },
    })
    expect(res.status).toBe(404)
  })

  it('DELETE returns 403 when deleting another users todo', async () => {
    const otherEmail = `test-other-del-${Date.now()}@example.com`
    const origin = process.env.TEST_HOST || 'http://localhost:3000'

    const signupRes = await fetch('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Origin': origin },
      body: JSON.stringify({
        name: 'Other User Del',
        email: otherEmail,
        password: 'TestPassword123!',
      }),
    })
    const otherBody = await signupRes.json()
    const otherUserId = otherBody?.user?.id
    if (!otherUserId) throw new Error('Failed to create other user')

    await pool.query('UPDATE users SET "emailVerified" = true WHERE id = $1', [otherUserId])

    const { rows } = await pool.query(
      'INSERT INTO todos (user_id, title, description, completed) VALUES ($1, $2, $3, $4) RETURNING id',
      [otherUserId, 'Other user todo', 'Not mine', false],
    )
    const otherTodoId = rows[0].id

    const res = await fetch(`/api/todos/${otherTodoId}`, {
      method: 'DELETE',
      headers: { cookie: cookies },
    })
    expect(res.status).toBe(403)

    // Cleanup
    await pool.query('DELETE FROM todos WHERE id = $1', [otherTodoId])
    await pool.query('DELETE FROM sessions WHERE "userId" = $1', [otherUserId])
    await pool.query('DELETE FROM accounts WHERE "userId" = $1', [otherUserId])
    await pool.query('DELETE FROM memberships WHERE user_id = $1', [otherUserId])
    await pool.query('DELETE FROM users WHERE id = $1', [otherUserId])
  })
})
