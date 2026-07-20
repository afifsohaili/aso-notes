import type { Transaction } from 'kysely'
import { AsyncLocalStorage } from 'node:async_hooks'
import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'

export interface DbContext {
  trx: Transaction<Database>
}

export const dbContext = new AsyncLocalStorage<DbContext>()

export function useDatabase(env: { databaseUrl: string }) {
  const activeTrx = dbContext.getStore()?.trx
  if (activeTrx)
    return activeTrx

  const pool = new pg.Pool({
    connectionString: env.databaseUrl,
  })

  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  })
}

export async function testDatabase(config: any): Promise<boolean> {
  try {
    const db = useDatabase(config)
    await db.selectFrom('accounts').select('id').limit(1).execute()
    return true
  }
  catch (error) {
    console.error('Database health check failed:', error)
    return false
  }
}
