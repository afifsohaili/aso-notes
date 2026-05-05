import process from 'node:process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { defineConfig } from 'kysely-ctl'
import { useDatabase } from '../utils/db'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  kysely: useDatabase({ databaseUrl: process.env.NUXT_DATABASE_URL || '' }),
  migrations: {
    migrationFolder: path.resolve(__dirname, '../migrations'),
    allowOrder: 'any',
  },
})
