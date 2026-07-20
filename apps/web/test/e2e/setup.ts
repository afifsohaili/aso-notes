import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { withFileDatabase } from '@base/testing/provisioning'
import dotenv from 'dotenv'

const appRoot = fileURLToPath(new URL('../..', import.meta.url))

// Make .env.local vars available before any test file modules are imported.
dotenv.config({ path: `${appRoot}/.env.local` })

// When running against a pre-started dev server we keep the shared dev DB so
// that the test process and the server see the same data.
if (!process.env.TEST_HOST) {
  // eslint-disable-next-line antfu/no-top-level-await
  await withFileDatabase({ appRoot })
}
