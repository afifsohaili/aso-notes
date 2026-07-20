import type { Kysely } from 'kysely'

let activeTransaction: Kysely<Database> | undefined

export function setActiveTransaction(trx?: Kysely<Database>): void {
  activeTransaction = trx
}

export function getActiveTransaction(): Kysely<Database> {
  if (!activeTransaction) {
    throw new Error(
      'No active test transaction found. Use helpers inside a test created with the @base/testing test object.',
    )
  }
  return activeTransaction
}

export function clearActiveTransaction(): void {
  activeTransaction = undefined
}
