import process from 'node:process'
import { afterAll } from 'vitest'
import {
  createTestDatabase,
  defaultTemplateName,
  dropTestDatabase,
  type ProvisioningOptions,
} from './test-database'

export interface WithFileDatabaseOptions extends ProvisioningOptions {}

export default async function withFileDatabase(
  opts: WithFileDatabaseOptions,
): Promise<string> {
  const templateName = opts.templateName ?? process.env.NUXT_TEST_TEMPLATE_NAME ?? defaultTemplateName()
  const dbUrl = await createTestDatabase({ ...opts, templateName })

  process.env.NUXT_DATABASE_URL = dbUrl
  process.env.DATABASE_URL = dbUrl

  afterAll(async () => {
    await dropTestDatabase(dbUrl, opts)
  })

  return dbUrl
}
