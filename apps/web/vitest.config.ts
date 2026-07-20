import { fileURLToPath } from 'node:url'
import { createTestingAliases, createTestingPlugin } from '@base/testing/vitest-plugin'
import { defineVitestProject } from '@nuxt/test-utils/config'
import { defineConfig } from 'vitest/config'

const appRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/*.{test,spec}.ts'],
          environment: 'node',
        },
      },
      {
        plugins: [createTestingPlugin({ appRoot })],
        resolve: {
          alias: createTestingAliases({ appRoot }),
        },
        test: {
          name: 'e2e',
          include: ['test/e2e/*.{test,spec}.ts'],
          environment: 'node',
          pool: 'forks',
          maxForks: 2,
          globalSetup: ['test/global-setup.ts'],
          setupFiles: ['test/e2e/setup.ts'],
        },
      },
      {
        plugins: [createTestingPlugin({ appRoot })],
        resolve: {
          alias: createTestingAliases({ appRoot }),
        },
        test: {
          name: 'e2e-built',
          include: ['test/e2e-built/*.{test,spec}.ts'],
          environment: 'node',
          pool: 'forks',
          maxForks: 2,
          globalSetup: ['test/e2e-built/global-setup.ts'],
          setupFiles: ['test/e2e-built/setup.ts'],
        },
      },
      await defineVitestProject({
        test: {
          name: 'nuxt',
          include: ['test/components/*.{test,spec}.ts'],
          environment: 'nuxt',
        },
      }),
    ],
  },
})
