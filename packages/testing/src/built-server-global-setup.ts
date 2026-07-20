import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { execSync } from 'node:child_process'

export interface GlobalSetupBuiltServerOptions {
  appRoot: string
  cacheDir?: string
}

async function collectFiles(dir: string): Promise<string[]> {
  const results: string[] = []
  if (!existsSync(dir))
    return results

  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...await collectFiles(fullPath))
    }
    else if (entry.isFile()) {
      results.push(fullPath)
    }
  }
  return results
}

function hashFiles(paths: string[]): string {
  const hash = createHash('sha256')
  for (const p of paths) {
    try {
      const s = statSync(p)
      hash.update(`${p}\n${s.mtimeMs}\n${s.size}\n`)
    }
    catch {
      // Skip files that disappear between listing and hashing.
    }
  }
  return hash.digest('hex').slice(0, 16)
}

export default async function globalSetupBuiltServer(
  opts: GlobalSetupBuiltServerOptions,
): Promise<() => Promise<void>> {
  const appRoot = opts.appRoot
  const cacheDir = opts.cacheDir ?? resolve(appRoot, '.output')
  const serverEntry = resolve(cacheDir, 'server/index.mjs')
  const hashFile = resolve(cacheDir, '.test-build-hash')

  const inputs = [
    resolve(appRoot, 'nuxt.config.ts'),
    resolve(appRoot, 'package.json'),
    resolve(appRoot, 'pnpm-lock.yaml'),
    ...(await collectFiles(resolve(appRoot, 'server'))),
    ...(await collectFiles(resolve(appRoot, 'utils'))),
  ]

  const currentHash = hashFiles(inputs)
  const cachedHash = existsSync(hashFile) ? readFileSync(hashFile, 'utf-8') : ''

  if (cachedHash !== currentHash || !existsSync(serverEntry)) {
    execSync('nuxt build', {
      cwd: appRoot,
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'production' },
    })
    writeFileSync(hashFile, currentHash)
  }

  process.env.NUXT_BUILT_SERVER_DIR = resolve(cacheDir, 'server')

  return async () => {
    delete process.env.NUXT_BUILT_SERVER_DIR
  }
}
