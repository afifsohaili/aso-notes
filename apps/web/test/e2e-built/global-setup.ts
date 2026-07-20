import process from 'node:process'
import { fileURLToPath } from 'node:url'
import globalSetupBuiltServer from '@base/testing/built-server-global-setup'
import { globalSetupTemplateDb } from '@base/testing/provisioning'
import dotenv from 'dotenv'

const appRoot = fileURLToPath(new URL('../..', import.meta.url))

// Make .env.local vars available to the global setup and any spawned scripts.
dotenv.config({ path: `${appRoot}/.env.local` })

export default async function setup() {
  if (process.env.TEST_HOST) {
    console.warn('TEST_HOST is set; skipping built server and template database creation.')
    return () => Promise.resolve()
  }

  const teardownDb = await globalSetupTemplateDb({ appRoot })
  const teardownServer = await globalSetupBuiltServer({ appRoot })

  return async () => {
    await teardownServer()
    await teardownDb()
  }
}
