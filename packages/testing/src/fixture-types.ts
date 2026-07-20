import type { DB } from '@monorepo/shared'

export type TableName = keyof DB & string

export type Row<T extends TableName> = DB[T]

export interface Ref {
  __ref: true
  label: string
  column: string
}

export interface FixtureDef<T extends TableName> {
  __fixture: true
  table: T
  attrs: Partial<Row<T>>
}

export type FixtureSchema = Record<string, FixtureDef<TableName>>

export interface FixtureLoader<S extends FixtureSchema> {
  load(schema: S): Promise<{ [K in keyof S]: Row<S[K]['table']> }>
}
