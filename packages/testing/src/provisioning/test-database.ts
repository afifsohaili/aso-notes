import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
import process from 'node:process'
import { Client } from 'pg'
import { endPoolsForDatabase } from '../pool-registry'

export interface ProvisioningOptions {
  appRoot: string
  adminDatabaseUrl?: string
  templateName?: string
}

function baseDatabaseUrl(): string {
  const url = process.env.NUXT_DATABASE_URL || process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      'NUXT_DATABASE_URL or DATABASE_URL must be set in the environment',
    )
  }
  return url
}

export function adminDatabaseUrl(opts?: Pick<ProvisioningOptions, 'adminDatabaseUrl'>): string {
  if (opts?.adminDatabaseUrl)
    return opts.adminDatabaseUrl
  const url = new URL(baseDatabaseUrl())
  url.pathname = '/postgres'
  return url.toString()
}

export function schemaSqlPath(appRoot: string): string {
  return resolve(appRoot, 'db/schema.sql')
}

export function defaultTemplateName(): string {
  return `base_nuxt_app_test_template_${process.pid}`
}

function adminClient(opts?: Pick<ProvisioningOptions, 'adminDatabaseUrl'>) {
  return new Client({ connectionString: adminDatabaseUrl(opts) })
}

export async function templateDatabaseExists(opts: ProvisioningOptions): Promise<boolean> {
  const client = adminClient(opts)
  await client.connect()
  try {
    const result = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [opts.templateName ?? defaultTemplateName()],
    )
    return (result.rowCount ?? 0) > 0
  }
  finally {
    await client.end()
  }
}

export async function createTemplateDatabase(opts: ProvisioningOptions): Promise<void> {
  const templateName = opts.templateName ?? defaultTemplateName()
  const client = adminClient(opts)
  await client.connect()
  try {
    // Guard against concurrent vitest runs corrupting the same template.
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [templateName])

    await client.query(
      `
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = $1
        AND pid <> pg_backend_pid()
      `,
      [templateName],
    )
    await client.query(`DROP DATABASE IF EXISTS "${templateName}"`)
    await client.query(`CREATE DATABASE "${templateName}"`)
    await client.query(`ALTER DATABASE "${templateName}" SET timezone TO 'UTC'`)
  }
  finally {
    // Release the advisory lock before the heavy psql load so other runs can
    // wait, and so we don't hold a connection on the template during the load.
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [templateName])
    await client.end()
  }

  const schemaPath = schemaSqlPath(opts.appRoot)
  try {
    execSync(`psql "${databaseUrlFor(templateName)}" -f "${schemaPath}"`, {
      cwd: opts.appRoot,
      stdio: 'pipe',
    })
  }
  catch (error) {
    const stderr = error instanceof Error && 'stderr' in error
      ? String((error as any).stderr)
      : ''
    throw new Error(
      `Failed to load schema into ${templateName}. Ensure db/schema.sql exists by running pnpm db:schema:dump.\n${stderr || String(error)}`,
    )
  }
}

export async function seedTemplateDatabase(opts: ProvisioningOptions & { seedScriptPath?: string }): Promise<void> {
  const seedPath = opts.seedScriptPath
    ? resolve(opts.appRoot, opts.seedScriptPath)
    : resolve(opts.appRoot, 'scripts/seed.ts')

  const { existsSync } = await import('node:fs')
  if (!existsSync(seedPath)) {
    console.warn(`No seed script found at ${seedPath}, skipping template seed`)
    return
  }

  const templateUrl = databaseForTemplate(opts.templateName ?? defaultTemplateName())
  const env = { ...process.env, NUXT_DATABASE_URL: templateUrl, DATABASE_URL: templateUrl }

  try {
    execSync('vite-node scripts/seed.ts', {
      cwd: opts.appRoot,
      stdio: 'pipe',
      env,
    })
  }
  catch (error) {
    const stderr = error instanceof Error && 'stderr' in error
      ? String((error as any).stderr)
      : ''
    throw new Error(
      `Failed to seed template database.\n${stderr || String(error)}`,
    )
  }
}

export function databaseUrlFor(name: string): string {
  const url = new URL(baseDatabaseUrl())
  url.pathname = `/${name}`
  return url.toString()
}

export function databaseForTemplate(templateName: string): string {
  return databaseUrlFor(templateName)
}

export async function createTestDatabase(opts: ProvisioningOptions): Promise<string> {
  const templateName = opts.templateName ?? defaultTemplateName()
  const dbName = `test_base_nuxt_app_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const client = adminClient(opts)
  await client.connect()
  try {
    await client.query(`CREATE DATABASE "${dbName}" TEMPLATE "${templateName}"`)
    await client.query(`ALTER DATABASE "${dbName}" SET timezone TO 'UTC'`)
  }
  finally {
    await client.end()
  }
  return databaseUrlFor(dbName)
}

export async function dropTestDatabase(dbUrl: string, opts?: Pick<ProvisioningOptions, 'adminDatabaseUrl'>): Promise<void> {
  const name = new URL(dbUrl).pathname.replace(/^\//, '')
  if (!name)
    return

  // End any pools we know about before forcibly terminating backends.
  await endPoolsForDatabase(dbUrl)

  const client = adminClient(opts)
  await client.connect()
  try {
    await client.query(
      `
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = $1
        AND pid <> pg_backend_pid()
      `,
      [name],
    )
    await client.query(`DROP DATABASE IF EXISTS "${name}"`)
  }
  finally {
    await client.end()
  }
}
