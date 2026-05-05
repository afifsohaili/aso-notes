import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'

// Load .env.local for DB access
const envFile = readFileSync(new URL('../../.env.local', import.meta.url), 'utf-8')
for (const line of envFile.split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/)
  if (match) {
    const key = match[1].trim()
    const value = match[2].trim().replace(/^["']|["']$/g, '')
    if (!process.env[key])
      process.env[key] = value
  }
}

const pool = new pg.Pool({
  connectionString: process.env.NUXT_DATABASE_URL || process.env.DATABASE_URL,
})

describe('todos schema', () => {
  beforeAll(async () => {
    // Ensure connection is healthy
    await pool.query('SELECT 1')
  })

  it('should have a todos table', async () => {
    const { rows } = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'todos'
    `)
    expect(rows.length).toBe(1)
  })

  it('should have the expected columns', async () => {
    const { rows } = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'todos'
      ORDER BY ordinal_position
    `)

    const columns = Object.fromEntries(
      rows.map((r: any) => [r.column_name, r]),
    )

    expect(columns.id).toBeDefined()
    expect(columns.id.data_type).toMatch(/integer|serial/)
    expect(columns.id.is_nullable).toBe('NO')

    expect(columns.user_id).toBeDefined()
    expect(columns.user_id.data_type).toBe('text')
    expect(columns.user_id.is_nullable).toBe('NO')

    expect(columns.title).toBeDefined()
    expect(columns.title.data_type).toMatch(/character varying|varchar/)
    expect(columns.title.is_nullable).toBe('NO')

    expect(columns.description).toBeDefined()
    expect(columns.description.data_type).toBe('text')
    expect(columns.description.is_nullable).toBe('YES')

    expect(columns.completed).toBeDefined()
    expect(columns.completed.data_type).toBe('boolean')
    expect(columns.completed.is_nullable).toBe('NO')
    expect(columns.completed.column_default).toBe('false')

    expect(columns.created_at).toBeDefined()
    expect(columns.created_at.data_type).toMatch(/timestamp.*/)
    expect(columns.created_at.is_nullable).toBe('NO')

    expect(columns.updated_at).toBeDefined()
    expect(columns.updated_at.data_type).toMatch(/timestamp.*/)
    expect(columns.updated_at.is_nullable).toBe('NO')
  })

  it('should have indexes on user_id and completed', async () => {
    const { rows } = await pool.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'todos'
    `)
    const indexNames = rows.map((r: any) => r.indexname)
    expect(indexNames).toContain('idx_todos_user_id')
    expect(indexNames).toContain('idx_todos_completed')
    expect(indexNames).toContain('idx_todos_created_at')
  })

  it('should have a foreign key from user_id to users.id', async () => {
    const { rows } = await pool.query(`
      SELECT
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
        AND tc.table_name = 'todos'
    `)

    const fk = rows.find((r: any) => r.column_name === 'user_id')
    expect(fk).toBeDefined()
    expect(fk.foreign_table_name).toBe('users')
    expect(fk.foreign_column_name).toBe('id')
  })
})
