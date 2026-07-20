import { execSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'

export interface DumpSchemaOptions {
  appRoot: string
  databaseUrl: string
  outPath: string
}

export default async function dumpSchema(opts: DumpSchemaOptions): Promise<void> {
  const outputDir = dirname(opts.outPath)
  if (!existsSync(outputDir))
    mkdirSync(outputDir, { recursive: true })

  const command = [
    'pg_dump',
    '--schema-only',
    '--no-owner',
    '--no-privileges',
    '--no-tablespaces',
    '--clean',
    '--if-exists',
    `--dbname=${opts.databaseUrl}`,
  ].join(' ')

  execSync(`${command} > "${opts.outPath}"`, {
    cwd: opts.appRoot,
    stdio: 'inherit',
  })
}

export function defaultSchemaOutPath(appRoot: string): string {
  return resolve(appRoot, 'db/schema.sql')
}
