import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import {
  createApp,
  createRouter,
  toWebHandler,
  type EventHandler,
  type Router,
} from 'h3'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

interface HandlerModule {
  default: EventHandler
}

export interface CreateServerCallerOptions {
  appRoot?: string
  excludeRoutes?: string[]
  runtimeConfig?: Record<string, unknown>
}

// Relative to packages/testing/src/ -> apps/web
const DEFAULT_APP_ROOT = resolve(__dirname, '../../../apps/web')
const DEFAULT_EXCLUDED_ROUTES = ['apps/web/server/api/_sitemap-urls.ts']

const apiModules = import.meta.glob<HandlerModule>([
  '../../../apps/web/server/api/**/*.ts',
  '!../../../apps/web/server/api/_sitemap-urls.ts',
], {
  eager: true,
  import: 'default',
})

const middlewareModules = import.meta.glob<HandlerModule>(
  '../../../apps/web/server/middleware/*.ts',
  {
    eager: true,
    import: 'default',
  },
)

function convertParamSyntax(path: string): string {
  return path
    .replace(/\[\.\.\.(\w+)\]/g, '**')
    .replace(/\[(\w+)\]/g, ':$1')
}

function filePathToRoutePattern(filePath: string): string {
  // Patterns come back as relative to packages/testing/src/, e.g.
  // '../../../apps/web/server/api/foo/bar.get.ts'
  const normalized = filePath
    .replace(/^\.\.\/\.\.\/\.\.\/apps\/web\/server\//, '')
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

  const converted = convertParamSyntax(routeBase)
  return `/${segment}/${converted}`
}

function routeFromPattern(pattern: string): { method?: string, path: string } {
  const lastDot = pattern.lastIndexOf('.')
  const method = lastDot > 0 ? pattern.slice(lastDot + 1).toLowerCase() : undefined
  const path = method ? pattern.slice(0, lastDot) : pattern
  return { method, path }
}

function registerMiddleware(
  app: ReturnType<typeof createApp>,
  runtimeConfig: Record<string, unknown> | undefined,
) {
  app.use(defineEventHandler((event) => {
    if (!event.context.runtimeConfig) {
      event.context.runtimeConfig = runtimeConfig ?? {
        databaseUrl: process.env.NUXT_DATABASE_URL || process.env.DATABASE_URL || '',
      }
    }
  }))

  const entries = Object.entries(middlewareModules).sort(([a], [b]) =>
    a.localeCompare(b),
  )

  for (const [, handler] of entries) {
    app.use(defineEventHandler(async event => handler(event)))
  }
}

function isExcluded(filePath: string, excludeRoutes: string[]): boolean {
  return excludeRoutes.some(pattern => filePath.includes(pattern))
}

function registerApiRoutes(
  router: Router,
  excludeRoutes: string[],
) {
  const entries = Object.entries(apiModules)
    .filter(([path]) => !isExcluded(path, excludeRoutes))
    .map(([path, handler]) => ({
      path,
      handler,
      pattern: filePathToRoutePattern(path),
    }))

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

export async function createServerCaller(
  opts: CreateServerCallerOptions = {},
): Promise<(path: string, init?: RequestInit) => Promise<Response>> {
  const app = createApp()

  registerMiddleware(app, opts.runtimeConfig)

  const router = createRouter({ preemptive: true })
  registerApiRoutes(router, [
    ...DEFAULT_EXCLUDED_ROUTES,
    ...(opts.excludeRoutes ?? []),
  ])
  app.use(router)

  const webHandler = toWebHandler(app)

  return async (path: string, init: RequestInit = {}): Promise<Response> => {
    const request = new Request(`http://test.local${path}`, init)
    return webHandler(request)
  }
}
