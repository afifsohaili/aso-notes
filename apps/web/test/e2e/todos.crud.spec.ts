import { givenVerifiedUser } from '@base/testing/auth'
import { test } from '@base/testing/test'
import { describe, expect } from 'vitest'

describe('todo CRUD API', () => {
  test('GET returns 401 when not authenticated', async ({ server }) => {
    const res = await server('/api/todos')
    expect(res.status).toBe(401)
  })

  test('GET returns 200 with todos array for authenticated user', async ({ server }) => {
    const { cookies } = await givenVerifiedUser()
    const res = await server('/api/todos', {
      headers: { cookie: cookies },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })

  test('GET only returns todos belonging to the authenticated user', async ({ server, trx }) => {
    const { user, cookies } = await givenVerifiedUser()

    await trx
      .insertInto('todos')
      .values({
        user_id: user.id,
        title: 'My Todo',
        description: 'Belongs to me',
        completed: false,
      })
      .execute()

    const res = await server('/api/todos', {
      headers: { cookie: cookies },
    })
    const body = await res.json()
    for (const todo of body) {
      expect(todo.user_id).toBe(user.id)
    }
  })

  test('GET returns todos ordered by created_at descending', async ({ server, trx }) => {
    const { user, cookies } = await givenVerifiedUser()

    await trx
      .insertInto('todos')
      .values([
        { user_id: user.id, title: 'Older Todo', description: '', completed: false },
        { user_id: user.id, title: 'Newer Todo', description: '', completed: false },
      ])
      .execute()

    const res = await server('/api/todos', {
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

  test('POST returns 401 when not authenticated', async ({ server }) => {
    const res = await server('/api/todos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Unauthorized' }),
    })
    expect(res.status).toBe(401)
  })

  test('POST creates a new todo and returns 201', async ({ server }) => {
    const { user, cookies } = await givenVerifiedUser()

    const res = await server('/api/todos', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cookie': cookies },
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
    expect(body.user_id).toBe(user.id)
  })

  test('POST returns 400 when title is missing', async ({ server }) => {
    const { cookies } = await givenVerifiedUser()
    const res = await server('/api/todos', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cookie': cookies },
      body: JSON.stringify({ description: 'No title here' }),
    })
    expect(res.status).toBe(400)
  })

  test('POST returns 400 when title is empty string', async ({ server }) => {
    const { cookies } = await givenVerifiedUser()
    const res = await server('/api/todos', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cookie': cookies },
      body: JSON.stringify({ title: '' }),
    })
    expect(res.status).toBe(400)
  })

  test('PUT returns 401 when not authenticated', async ({ server, trx }) => {
    const { user } = await givenVerifiedUser()
    const [todo] = await trx
      .insertInto('todos')
      .values({ user_id: user.id, title: 'Protected Todo', description: '', completed: false })
      .returning('id')
      .execute()

    const res = await server(`/api/todos/${todo.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Hacked' }),
    })
    expect(res.status).toBe(401)
  })

  test('PUT updates a todo and returns 200', async ({ server, trx }) => {
    const { user, cookies } = await givenVerifiedUser()
    const [todo] = await trx
      .insertInto('todos')
      .values({ user_id: user.id, title: 'Update Todo', description: '', completed: false })
      .returning('id')
      .execute()

    const res = await server(`/api/todos/${todo.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'cookie': cookies },
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

  test('PUT returns 404 for non-existent todo', async ({ server }) => {
    const { cookies } = await givenVerifiedUser()
    const res = await server('/api/todos/999999', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'cookie': cookies },
      body: JSON.stringify({ title: 'Ghost' }),
    })
    expect(res.status).toBe(404)
  })

  test('PUT returns 403 when updating another users todo', async ({ server, trx }) => {
    const { cookies } = await givenVerifiedUser()
    const otherUser = await givenVerifiedUser({ email: `other-${Date.now()}@example.com` })

    const [otherTodo] = await trx
      .insertInto('todos')
      .values({ user_id: otherUser.user.id, title: 'Other user todo', description: 'Not mine', completed: false })
      .returning('id')
      .execute()

    const res = await server(`/api/todos/${otherTodo.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'cookie': cookies },
      body: JSON.stringify({ title: 'Hacked' }),
    })
    expect(res.status).toBe(403)
  })

  test('DELETE returns 401 when not authenticated', async ({ server, trx }) => {
    const { user } = await givenVerifiedUser()
    const [todo] = await trx
      .insertInto('todos')
      .values({ user_id: user.id, title: 'Protected Todo', description: '', completed: false })
      .returning('id')
      .execute()

    const res = await server(`/api/todos/${todo.id}`, {
      method: 'DELETE',
    })
    expect(res.status).toBe(401)
  })

  test('DELETE removes a todo and returns 200', async ({ server, trx }) => {
    const { user, cookies } = await givenVerifiedUser()
    const [todo] = await trx
      .insertInto('todos')
      .values({ user_id: user.id, title: 'Todo to delete', description: 'Temporary', completed: false })
      .returning('id')
      .execute()

    const res = await server(`/api/todos/${todo.id}`, {
      method: 'DELETE',
      headers: { cookie: cookies },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)

    const remaining = await trx
      .selectFrom('todos')
      .select('id')
      .where('id', '=', todo.id)
      .execute()
    expect(remaining).toHaveLength(0)
  })

  test('DELETE returns 404 for non-existent todo', async ({ server }) => {
    const { cookies } = await givenVerifiedUser()
    const res = await server('/api/todos/999999', {
      method: 'DELETE',
      headers: { cookie: cookies },
    })
    expect(res.status).toBe(404)
  })

  test('DELETE returns 403 when deleting another users todo', async ({ server, trx }) => {
    const { cookies } = await givenVerifiedUser()
    const otherUser = await givenVerifiedUser({ email: `other-del-${Date.now()}@example.com` })

    const [otherTodo] = await trx
      .insertInto('todos')
      .values({ user_id: otherUser.user.id, title: 'Other user todo', description: 'Not mine', completed: false })
      .returning('id')
      .execute()

    const res = await server(`/api/todos/${otherTodo.id}`, {
      method: 'DELETE',
      headers: { cookie: cookies },
    })
    expect(res.status).toBe(403)
  })
})
