import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import * as h3 from 'h3'
import unimport from 'unimport/unplugin'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const appRoot = resolve(__dirname, '../apps/web')
const runtimeConfigPath = resolve(__dirname, 'runtime-config.ts')

export default defineConfig({
  root: resolve(__dirname, '..'),
  plugins: [
    unimport.vite({
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
    }),
  ],
  resolve: {
    alias: {
      '~~': appRoot,
      '~': appRoot,
      '#server': resolve(appRoot, 'server'),
      '@monorepo/shared': resolve(__dirname, '../packages/shared/types.d.ts'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['spike/**/*.spec.ts'],
  },
})
