import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import process from 'node:process'
import { afterAll } from 'vitest'

export interface WithBuiltServerOptions {
  baseUrl?: string
  env?: Record<string, string>
}

export interface BuiltServer {
  baseUrl: string
}

function findServerDir(): string {
  const fromEnv = process.env.NUXT_BUILT_SERVER_DIR
  if (fromEnv)
    return fromEnv
  return resolve(process.cwd(), '.output/server')
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, () => {
      const address = server.address()
      if (typeof address === 'object' && address) {
        const port = address.port
        server.close(() => resolve(port))
      }
      else {
        server.close(() => reject(new Error('Could not determine ephemeral port')))
      }
    })
    server.on('error', reject)
  })
}

async function waitForReadiness(baseUrl: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/healthcheck`)
      if (res.ok)
        return
    }
    catch {
      // Server not ready yet.
    }
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error(`Built server at ${baseUrl} did not become ready within ${timeoutMs}ms`)
}

export async function withBuiltServer(opts: WithBuiltServerOptions = {}): Promise<BuiltServer> {
  const serverDir = findServerDir()
  const serverEntry = resolve(serverDir, 'index.mjs')

  if (!existsSync(serverEntry)) {
    throw new Error(
      `Built server not found at ${serverEntry}. ` +
      'Ensure globalSetupBuiltServer ran (nuxt build) before using withBuiltServer.',
    )
  }

  const port = await findFreePort()
  const baseUrl = opts.baseUrl ?? `http://localhost:${port}`
  const startupLogs: string[] = []

  // Start on a pre-selected free port. Nitro ignores PORT=0 in production, so
  // we bind an ephemeral port ourselves and pass it explicitly.
  const child = spawn('node', [serverEntry], {
    env: {
      ...process.env,
      NITRO_PORT: String(port),
      NUXT_DATABASE_URL: process.env.NUXT_DATABASE_URL,
      DATABASE_URL: process.env.DATABASE_URL,
      NUXT_REDIS_URL: process.env.NUXT_REDIS_URL,
      NUXT_BETTER_AUTH_SECRET: process.env.NUXT_BETTER_AUTH_SECRET,
      NUXT_DISABLE_EMAIL_WORKER: '1',
      NUXT_DISABLE_NOTES_SYNC: '1',
      ...opts.env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  // Ensure the child cannot outlive the test process, even if the test file
  // crashes or is interrupted before afterAll runs.
  const killOnExit = () => {
    try {
      child.kill('SIGTERM')
    }
    catch {
      // Already exited.
    }
  }
  process.once('exit', killOnExit)
  process.once('SIGINT', killOnExit)
  process.once('SIGTERM', killOnExit)

  child.stdout?.on('data', (data: Buffer) => {
    startupLogs.push(data.toString())
  })
  child.stderr?.on('data', (data: Buffer) => {
    startupLogs.push(data.toString())
  })

  const ready = await new Promise<boolean>((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`Timed out waiting for built server to start. Logs:\n${startupLogs.join('')}`))
    }, 15000)

    child.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })

    child.on('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`Built server exited with code ${code}. Logs:\n${startupLogs.join('')}`))
    })

    // Wait until the healthcheck responds, which means the server is ready.
    waitForReadiness(baseUrl, 15000)
      .then(() => {
        clearTimeout(timeout)
        resolvePromise(true)
      })
      .catch((err) => {
        clearTimeout(timeout)
        child.kill('SIGTERM')
        reject(new Error(`${err.message}. Logs:\n${startupLogs.join('')}`))
      })
  })

  if (!ready) {
    child.kill('SIGTERM')
    throw new Error(`Built server did not become ready. Logs:\n${startupLogs.join('')}`)
  }

  afterAll(async () => {
    process.off('exit', killOnExit)
    process.off('SIGINT', killOnExit)
    process.off('SIGTERM', killOnExit)

    child.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        }
        catch {
          // Already dead.
        }
        resolve()
      }, 5000)
      child.on('exit', () => {
        clearTimeout(timeout)
        resolve()
      })
    })
  })

  return { baseUrl }
}
