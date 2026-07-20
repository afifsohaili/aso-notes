import type pg from 'pg'

const poolsByDatabase = new Map<string, Set<pg.Pool>>()

export function registerPool(databaseUrl: string, pool: pg.Pool): void {
  let set = poolsByDatabase.get(databaseUrl)
  if (!set) {
    set = new Set()
    poolsByDatabase.set(databaseUrl, set)
  }
  set.add(pool)

  pool.on('remove', () => {
    set?.delete(pool)
  })
}

export async function endPoolsForDatabase(databaseUrl: string): Promise<void> {
  const set = poolsByDatabase.get(databaseUrl)
  if (!set)
    return

  const pools = Array.from(set)
  set.clear()

  await Promise.all(
    pools.map(async (pool) => {
      try {
        await pool.end()
      }
      catch {
        // Ignore errors from pools that are already closing.
      }
    }),
  )
}

export function clearPoolRegistry(): void {
  poolsByDatabase.clear()
}
