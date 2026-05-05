import process from 'node:process'
import { defineConfig } from 'kysely-ctl'
import { useDatabase } from '../utils/db'

export default defineConfig({
  kysely: useDatabase({ databaseUrl: process.env.NUXT_DATABASE_URL || '' }),
  migrations: {
    migrationFolder: 'migrations',
  },
})
