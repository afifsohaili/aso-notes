import { dbContext } from './transaction'
import { getActiveTransaction } from './active-transaction'
import type {
  FixtureDef,
  FixtureLoader,
  FixtureSchema,
  Ref,
  Row,
  TableName,
} from './fixture-types'

export * from './fixture-types'

export function ref(label: string, column = 'id'): Ref {
  return { __ref: true, label, column }
}

export function fixture<T extends TableName>(
  table: T,
  attrs: Partial<Row<T>> = {},
): FixtureDef<T> {
  return { __fixture: true, table, attrs }
}

function isRef(value: unknown): value is Ref {
  return value !== null
    && typeof value === 'object'
    && '__ref' in value
    && (value as Ref).__ref === true
}

function topologicalSort<S extends FixtureSchema>(
  schema: S,
): Array<keyof S & string> {
  const labels = Object.keys(schema) as Array<keyof S & string>
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const order: Array<keyof S & string> = []

  function visit(label: string, stack: string[]) {
    if (visited.has(label))
      return
    if (visiting.has(label)) {
      const cycle = stack.slice(stack.indexOf(label)).concat(label).join(' -> ')
      throw new Error(`Fixture reference cycle detected: ${cycle}`)
    }

    visiting.add(label)
    const def = schema[label]
    for (const value of Object.values(def.attrs)) {
      if (isRef(value)) {
        if (!labels.includes(value.label)) {
          throw new Error(
            `Fixture "${String(label)}" references unknown fixture "${value.label}"`,
          )
        }
        visit(value.label, [...stack, label])
      }
    }
    visiting.delete(label)
    visited.add(label)
    order.push(label)
  }

  for (const label of labels)
    visit(label, [])

  return order
}

export function defineFixtures<S extends FixtureSchema>(_defaultSchema?: S): FixtureLoader<S> {
  return {
    async load(schema) {
      const trx = (dbContext.getStore()?.trx ?? getActiveTransaction()) as Kysely<Database> | undefined
      if (!trx) {
        throw new Error(
          'No active test transaction found. Use fixtures inside a test created with the @base/testing test object.',
        )
      }

      const order = topologicalSort(schema)
      const inserted: Record<string, Record<string, unknown>> = {}
      const results: Record<string, unknown> = {}

      for (const label of order) {
        const def = schema[label]
        const values: Record<string, unknown> = {}

        for (const [key, raw] of Object.entries(def.attrs)) {
          if (isRef(raw)) {
            const target = inserted[raw.label]
            if (!target) {
              throw new Error(
                `Fixture "${String(label)}" references "${raw.label}.${raw.column}" before it was inserted`,
              )
            }
            values[key] = target[raw.column]
          }
          else {
            values[key] = raw
          }
        }

        try {
          const [row] = await trx
            .insertInto(def.table)
            .values(values as any)
            .returningAll()
            .execute()

          if (!row) {
            throw new Error(
              `Insert for fixture "${String(label)}" on table "${def.table}" returned no rows`,
            )
          }

          inserted[label] = row as Record<string, unknown>
          results[label] = row
        }
        catch (error) {
          throw new Error(
            `Failed to insert fixture "${String(label)}" on table "${def.table}": ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }

      return results as { [K in keyof S]: Row<S[K]['table']> }
    },
  }
}
