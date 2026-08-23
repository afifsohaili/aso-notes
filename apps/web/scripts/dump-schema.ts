import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { defaultSchemaOutPath, dumpSchema } from '@base/testing/provisioning'
import dotenv from 'dotenv'

const appRoot = fileURLToPath(new URL('..', import.meta.url))

dotenv.config({ path: `${appRoot}/.env.local` })

const baseUrl = process.env.NUXT_DATABASE_URL || process.env.DATABASE_URL
if (!baseUrl) {
  throw new Error(
    'NUXT_DATABASE_URL or DATABASE_URL must be set in .env.local',
  )
}

const outPath = defaultSchemaOutPath(appRoot)
const tempDbName = `base_nuxt_app_schema_dump_${Date.now()}_${process.pid}`
const tempUrl = baseUrl.replace(/\/[^/]*$/, `/${tempDbName}`)

function run(command: string, env: Record<string, string> = {}) {
  execSync(command, {
    cwd: appRoot,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  })
}

function runPsql(sql: string) {
  const adminUrl = baseUrl.replace(/\/[^/]*$/, '/postgres')
  execSync(`psql "${adminUrl}" -c "${sql.replace(/"/g, '\\"')}"`, {
    cwd: appRoot,
    stdio: 'pipe',
  })
}

console.log(`Creating temporary database ${tempDbName}...`)
runPsql(`CREATE DATABASE "${tempDbName}"`)

try {
  console.log('Applying migrations...')
  run('kysely migrate latest', { NUXT_DATABASE_URL: tempUrl })

  console.log(`Dumping schema to ${outPath}...`)
  await dumpSchema({ appRoot, databaseUrl: tempUrl, outPath })

  // pg_dump 16.15 emits a random `\restrict`/`\unrestrict` token on every run
  // (a psql session-scoped security key). It is noise, not schema, and would
  // churn the committed file on each dump, so strip it.
  const sql = readFileSync(outPath, 'utf8')
  const cleaned = sql
    .replace(/^\\restrict \S+\n\n?/m, '')
    .replace(/\n\\unrestrict \S+\s*$/, '\n')
  writeFileSync(outPath, cleaned)

  console.log(`Schema dumped to ${outPath}`)
}
finally {
  console.log(`Dropping temporary database ${tempDbName}...`)
  try {
    runPsql(`DROP DATABASE IF EXISTS "${tempDbName}"`)
  }
  catch (error) {
    console.error(`Failed to drop temporary database: ${error instanceof Error ? error.message : String(error)}`)
  }
}
