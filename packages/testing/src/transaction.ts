import { AsyncLocalStorage } from 'node:async_hooks'
import type { Transaction } from 'kysely'
import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'
import { registerPool } from './pool-registry'

export interface DbContext {
  trx: Transaction<Database>
}

export const dbContext = new AsyncLocalStorage<DbContext>()

export function createFileDatabase(): Kysely<Database> {
  const url = process.env.NUXT_DATABASE_URL || process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      'NUXT_DATABASE_URL or DATABASE_URL must be set before creating the test database pool.',
    )
  }

  const pool = new pg.Pool({
    connectionString: url,
    // Leave headroom for concurrent transactions in the same file.
    max: 10,
  })

  registerPool(url, pool)

  // Swallow errors emitted by clients that are terminated during teardown
  // (e.g. when DROP DATABASE forces existing backends to close).
  pool.on('connect', (client) => {
    client.on('error', () => {})
  })
  pool.on('error', () => {})

  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  })
}
