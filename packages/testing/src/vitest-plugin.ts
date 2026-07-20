import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import * as h3 from 'h3'
import unimport from 'unimport/unplugin'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

export interface TestingPluginOptions {
  appRoot?: string
}

export function createTestingPlugin(options: TestingPluginOptions = {}) {
  const appRoot = options.appRoot ?? resolve(__dirname, '../../../apps/web')
  const runtimeConfigPath = resolve(__dirname, 'runtime-config.ts')

  return unimport.vite({
    presets: [
      { from: 'h3', imports: Object.keys(h3) },
      { from: runtimeConfigPath, imports: ['useRuntimeConfig'] },
    ],
    dirs: [
      resolve(appRoot, 'utils'),
      resolve(appRoot, 'server/utils'),
      resolve(appRoot, 'server/lib'),
    ],
    dts: false,
  })
}

export function createTestingAliases(options: TestingPluginOptions = {}) {
  const appRoot = options.appRoot ?? resolve(__dirname, '../../../apps/web')

  return {
    '~~': appRoot,
    '~': appRoot,
    '#server': resolve(appRoot, 'server'),
    '@monorepo/shared': resolve(__dirname, '../../shared/types.d.ts'),
  }
}
