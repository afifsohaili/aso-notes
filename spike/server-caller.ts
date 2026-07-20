import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { createApp, createRouter, toWebHandler, type EventHandler, type H3Event, type Router } from 'h3'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

interface HandlerModule {
  default: EventHandler
}

// Dynamically load all API handlers and middleware.
// _sitemap-urls.ts is excluded because it depends on @nuxt/content internals
// (e.g. #content/manifest) that only exist inside a real Nuxt build.
const apiModules = import.meta.glob<HandlerModule>([
  '../apps/web/server/api/**/*.ts',
  '!../apps/web/server/api/_sitemap-urls.ts',
], {
  eager: true,
  import: 'default',
})

const middlewareModules = import.meta.glob<HandlerModule>('../apps/web/server/middleware/*.ts', {
  eager: true,
  import: 'default',
})

function convertParamSyntax(path: string): string {
  return path
    .replace(/\[\.\.\.(\w+)\]/g, '**')
    .replace(/\[(\w+)\]/g, ':$1')
}

function filePathToRoutePattern(filePath: string): string {
  // Strip prefix and extension: ../apps/web/server/api/foo/bar.get.ts -> api/foo/bar.get
  const normalized = filePath
    .replace(/^\.\.\/apps\/web\/server\//, '')
    .replace(/\.ts$/, '')

  const [segment, ...rest] = normalized.split('/')
  if (segment !== 'api')
    throw new Error(`Unexpected handler path: ${filePath}`)

  const routeBase = rest.join('/')

  // Convert index.get.ts patterns: foo/index.get -> GET /api/foo
  const indexMatch = routeBase.match(/^(.*)\/index\.(\w+)$/)
  if (indexMatch) {
    const prefix = indexMatch[1] ? `/${convertParamSyntax(indexMatch[1])}` : ''
    return `/${segment}${prefix}.${indexMatch[2]}`
  }

  // Convert [...auth].ts or [id].get.ts, including nested paths.
  const converted = convertParamSyntax(routeBase)

  // Default: foo.get.ts -> /api/foo.get
  return `/${segment}/${converted}`
}

function routeFromPattern(pattern: string): { method?: string, path: string } {
  const lastDot = pattern.lastIndexOf('.')
  const method = lastDot > 0 ? pattern.slice(lastDot + 1).toLowerCase() : undefined
  const path = method ? pattern.slice(0, lastDot) : pattern
  return { method, path }
}

function registerMiddleware(app: ReturnType<typeof createApp>) {
  const entries = Object.entries(middlewareModules)
    .sort(([a], [b]) => a.localeCompare(b))

  for (const [, handler] of entries) {
    app.use(defineEventHandler(async (event) => {
      return await handler(event)
    }))
  }
}

function registerApiRoutes(router: Router) {
  const entries = Object.entries(apiModules)
    .map(([path, handler]) => ({ path, handler, pattern: filePathToRoutePattern(path) }))

  // Register specific routes before catch-alls so h3's router prefers exact matches.
  const catchAlls = entries.filter(e => e.pattern.includes('**'))
  const specifics = entries.filter(e => !e.pattern.includes('**'))
  specifics.sort((a, b) => b.pattern.localeCompare(a.pattern))

  for (const { pattern, handler } of [...specifics, ...catchAlls]) {
    const { method, path } = routeFromPattern(pattern)
    if (!method) {
      router.use(path, handler)
    }
    else {
      router.use(path, handler, method)
    }
  }
}

export async function createServerCaller() {
  const app = createApp()

  // Optional: inject a runtime config fallback if plain h3 does not derive it from env.
  app.use(defineEventHandler((event) => {
    if (!event.context.runtimeConfig) {
      event.context.runtimeConfig = {
        databaseUrl: process.env.NUXT_DATABASE_URL || process.env.DATABASE_URL || '',
      }
    }
  }))

  registerMiddleware(app)

  const router = createRouter({ preemptive: true })
  registerApiRoutes(router)
  app.use(router)

  const webHandler = toWebHandler(app)

  return async (path: string, init: RequestInit = {}): Promise<Response> => {
    const request = new Request(`http://test.local${path}`, init)
    return webHandler(request)
  }
}
