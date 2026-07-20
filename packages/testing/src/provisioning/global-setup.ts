import process from 'node:process'
import {
  createTemplateDatabase,
  defaultTemplateName,
  seedTemplateDatabase,
  type ProvisioningOptions,
} from './test-database'

export interface GlobalSetupTemplateDbOptions extends ProvisioningOptions {
  seedScriptPath?: string
}

export default async function globalSetupTemplateDb(
  opts: GlobalSetupTemplateDbOptions,
): Promise<() => Promise<void>> {
  const templateName = opts.templateName ?? defaultTemplateName()

  // Publish the template name so per-file setup can clone from the same DB.
  process.env.NUXT_TEST_TEMPLATE_NAME = templateName

  await createTemplateDatabase(opts)
  if (opts.seedScriptPath)
    await seedTemplateDatabase(opts)

  return async () => {
    delete process.env.NUXT_TEST_TEMPLATE_NAME
  }
}
