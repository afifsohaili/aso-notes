import { test } from '@base/testing/test'
import { describe, expect } from 'vitest'

describe('gET /api/healthcheck', () => {
  test('should return 200 OK with database connection = true', async ({ server }) => {
    const response = await server('/api/healthcheck')
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.database).toBe(true)
  })
})
