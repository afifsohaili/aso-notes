import type { Transaction } from 'kysely'
import type { Kysely } from 'kysely'
import { test as vitestTest } from 'vitest'
import { createServerCaller } from './server-caller'
import { dbContext, createFileDatabase } from './transaction'
import { setActiveTransaction, clearActiveTransaction } from './active-transaction'
import { defineFixtures } from './fixtures'
import { queueTesting } from './queue'
import type { FixtureLoader } from './fixtures'
import type { QueueTestingFacade } from './queue'

export interface TestFixtures {
  db: Kysely<Database>
  trx: Kysely<Database>
  server: (path: string, init?: RequestInit) => Promise<Response>
  fixtures: FixtureLoader<never>
  queue: QueueTestingFacade
}

const defaultFixtures = defineFixtures({})

export const test = vitestTest.extend<TestFixtures>({
  db: [async ({}, use) => {
    const db = createFileDatabase()
    await use(db)
    // The pool is ended by withFileDatabase's afterAll via the pool registry,
    // so we do not call db.destroy() here (pg-pool throws on double end).
  }, { scope: 'file' }],
  trx: async ({ db }, use) => {
    const trx = await db.startTransaction().execute()
    setActiveTransaction(trx as unknown as Kysely<Database>)
    try {
      await dbContext.run({ trx }, async () => {
        await use(trx as unknown as Kysely<Database>)
      })
    }
    finally {
      clearActiveTransaction()
      await trx.rollback().execute()
    }
  },
  server: async ({ trx }, use) => {
    const caller = await createServerCaller()
    const testTrx = trx as unknown as Transaction<Database>
    await use(async (path: string, init?: RequestInit) => {
      const g = globalThis as any
      const prev = g.__BASE_TESTING_TRX__
      g.__BASE_TESTING_TRX__ = testTrx
      try {
        return await caller(path, init)
      }
      finally {
        g.__BASE_TESTING_TRX__ = prev
      }
    })
  },
  fixtures: async ({}, use) => {
    await use(defaultFixtures as unknown as FixtureLoader<never>)
  },
  queue: async ({}, use) => {
    queueTesting.reset()
    await use(queueTesting)
  },
})
