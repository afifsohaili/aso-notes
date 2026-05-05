import { readFileSync } from 'node:fs'
import { fetch, setup, url } from '@nuxt/test-utils/e2e'
import pg from 'pg'
import WebSocket from 'ws'
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

describe('Todo WebSocket Real-Time API', async () => {
  await setup({
    host: process.env.TEST_HOST,
  })

  const pool = new pg.Pool({
    connectionString: process.env.NUXT_DATABASE_URL || process.env.DATABASE_URL,
  })

  let user1Cookies: string
  let user2Cookies: string
  let user1Id: string
  let user2Id: string
  const user1Email = `test-ws-1-${Date.now()}@example.com`
  const user2Email = `test-ws-2-${Date.now()}@example.com`

  async function createUserAndLogin(email: string): Promise<{ cookies: string, userId: string }> {
    const origin = url('/')

    const signupRes = await fetch('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Origin': origin },
      body: JSON.stringify({
        name: 'Test WS User',
        email,
        password: 'TestPassword123!',
      }),
    })

    const body = await signupRes.json()
    const userId = body?.user?.id
    if (!userId) {
      throw new Error(`Sign-up failed: ${JSON.stringify(body)}`)
    }

    await pool.query('UPDATE users SET "emailVerified" = true WHERE id = $1', [userId])

    const loginRes = await fetch('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Origin': origin },
      body: JSON.stringify({ email, password: 'TestPassword123!' }),
    })

    const setCookies = loginRes.headers.getSetCookie?.() ?? []
    const cookies = setCookies.map(c => c.split(';')[0]).join('; ')

    return { cookies, userId }
  }

  function connectWebSocket(cookies: string): Promise<WebSocket> {
    const serverUrl = url('/')
    const wsUrl = serverUrl.replace(/^http/, 'ws') + 'api/todos/ws'

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl, {
        headers: { Cookie: cookies },
      })

      ws.on('open', () => resolve(ws))
      ws.on('error', reject)

      setTimeout(() => reject(new Error('WebSocket connection timeout')), 5000)
    })
  }

  function waitForMessage(ws: WebSocket, timeout = 5000): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Message timeout')), timeout)
      ws.once('message', (data) => {
        clearTimeout(timer)
        resolve(JSON.parse(data.toString()))
      })
    })
  }

  beforeAll(async () => {
    const u1 = await createUserAndLogin(user1Email)
    user1Cookies = u1.cookies
    user1Id = u1.userId

    const u2 = await createUserAndLogin(user2Email)
    user2Cookies = u2.cookies
    user2Id = u2.userId
  })

  afterAll(async () => {
    await pool.query('DELETE FROM todos WHERE user_id IN ($1, $2)', [user1Id, user2Id])
    await pool.query('DELETE FROM sessions WHERE "userId" IN ($1, $2)', [user1Id, user2Id])
    await pool.query('DELETE FROM accounts WHERE "userId" IN ($1, $2)', [user1Id, user2Id])
    await pool.query('DELETE FROM memberships WHERE user_id IN ($1, $2)', [user1Id, user2Id])
    await pool.query('DELETE FROM users WHERE id IN ($1, $2)', [user1Id, user2Id])
    await pool.end()
  })

  it('rejects unauthenticated WebSocket connections', async () => {
    const serverUrl = url('/')
    const wsUrl = serverUrl.replace(/^http/, 'ws') + 'api/todos/ws'

    const ws = new WebSocket(wsUrl)

    const closeEvent = await new Promise<{ code: number, wasClean: boolean }>((resolve) => {
      ws.on('close', (code, reason) => resolve({ code, wasClean: true }))
      ws.on('error', () => resolve({ code: -1, wasClean: false }))
      setTimeout(() => resolve({ code: -1, wasClean: false }), 5000)
    })

    expect(closeEvent.code).toBe(1008)
    ws.terminate()
  })

  it('accepts authenticated WebSocket connections', async () => {
    const ws = await connectWebSocket(user1Cookies)
    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
  })

  it('receives todo.created event when a todo is created', async () => {
    const ws = await connectWebSocket(user1Cookies)

    const createRes = await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: user1Cookies },
      body: JSON.stringify({ title: 'WebSocket Todo', description: 'Test WS' }),
    })
    expect(createRes.status).toBe(201)

    const msg = await waitForMessage(ws)
    expect(msg.type).toBe('todo.created')
    expect(msg.payload.title).toBe('WebSocket Todo')
    expect(msg.payload.user_id).toBe(user1Id)

    ws.close()
  })

  it('receives todo.updated event when a todo is updated', async () => {
    // Create a todo first
    const createRes = await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: user1Cookies },
      body: JSON.stringify({ title: 'Update Test Todo' }),
    })
    const createdTodo = await createRes.json()

    const ws = await connectWebSocket(user1Cookies)

    // Consume the creation event
    await waitForMessage(ws)

    // Update the todo
    const updateRes = await fetch(`/api/todos/${createdTodo.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie: user1Cookies },
      body: JSON.stringify({ title: 'Updated Title', completed: true }),
    })
    expect(updateRes.status).toBe(200)

    const msg = await waitForMessage(ws)
    expect(msg.type).toBe('todo.updated')
    expect(msg.payload.title).toBe('Updated Title')
    expect(msg.payload.completed).toBe(true)

    ws.close()
  })

  it('receives todo.deleted event when a todo is deleted', async () => {
    // Create a todo first
    const createRes = await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: user1Cookies },
      body: JSON.stringify({ title: 'Delete Test Todo' }),
    })
    const createdTodo = await createRes.json()

    const ws = await connectWebSocket(user1Cookies)

    // Consume the creation event
    await waitForMessage(ws)

    // Delete the todo
    const deleteRes = await fetch(`/api/todos/${createdTodo.id}`, {
      method: 'DELETE',
      headers: { cookie: user1Cookies },
    })
    expect(deleteRes.status).toBe(200)

    const msg = await waitForMessage(ws)
    expect(msg.type).toBe('todo.deleted')
    expect(msg.payload.id).toBe(createdTodo.id)

    ws.close()
  })

  it('does not broadcast events to other users', async () => {
    const ws1 = await connectWebSocket(user1Cookies)
    const ws2 = await connectWebSocket(user2Cookies)

    // User 1 creates a todo
    const createRes = await fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: user1Cookies },
      body: JSON.stringify({ title: 'User 1 Private Todo' }),
    })
    expect(createRes.status).toBe(201)

    // User 1 should receive the event
    const msg1 = await waitForMessage(ws1)
    expect(msg1.type).toBe('todo.created')
    expect(msg1.payload.title).toBe('User 1 Private Todo')

    // User 2 should NOT receive the event (set a short timeout)
    const user2Received = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 1000)
      ws2.once('message', () => {
        clearTimeout(timer)
        resolve(true)
      })
    })
    expect(user2Received).toBe(false)

    ws1.close()
    ws2.close()
  })

  it('handles ping/pong keepalive', async () => {
    const ws = await connectWebSocket(user1Cookies)

    const pongPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Pong timeout')), 2000)
      ws.on('pong', () => {
        clearTimeout(timer)
        resolve()
      })
    })

    ws.ping()
    await pongPromise

    ws.close()
  })
})
