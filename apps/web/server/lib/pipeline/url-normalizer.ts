/**
 * URL normalization for Sources (plan-002-system §URL normalization).
 *
 * Stores `url` (raw) + `url_normalized` (canonical, scheme-less) per note.
 * Canonical rules: lowercase scheme/host, strip `www.`, strip fragment,
 * strip trailing slash, strip query params except a per-host keep-list
 * (`youtube.com`: keep `v`), rewrite `youtu.be/ID` → `youtube.com/watch?v=ID`.
 */

export type SourceType = 'youtube' | 'tiktok' | 'web'

interface HostRule {
  /** Query params preserved during normalization; all others are stripped. */
  keepParams: string[]
  type: SourceType
}

const HOST_RULES: Record<string, HostRule> = {
  'youtube.com': { keepParams: ['v'], type: 'youtube' },
  'youtu.be': { keepParams: [], type: 'youtube' },
  'tiktok.com': { keepParams: [], type: 'tiktok' },
}

const DEFAULT_TYPE: SourceType = 'web'

function hostKey(host: string): string | null {
  if (host === 'youtu.be')
    return 'youtu.be'
  for (const key of Object.keys(HOST_RULES)) {
    if (host === key || host.endsWith(`.${key}`))
      return key
  }
  return null
}

export function normalizeUrl(raw: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(raw.trim())
  }
  catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    return null

  let host = parsed.hostname.toLowerCase()
  if (host.startsWith('www.'))
    host = host.slice(4)

  // youtu.be/ID → youtube.com/watch?v=ID
  if (host === 'youtu.be') {
    const id = parsed.pathname.replace(/^\//, '').split('/')[0]
    if (!id)
      return 'youtube.com'
    return `youtube.com/watch?v=${encodeURIComponent(id)}`
  }

  const rule = hostKey(host) ? HOST_RULES[hostKey(host)!] : null
  const keep = new Set(rule?.keepParams ?? [])

  const keptParams: string[] = []
  for (const [key, value] of parsed.searchParams) {
    if (keep.has(key))
      keptParams.push(`${key}=${value}`)
  }

  let path = parsed.pathname
  if (path.length > 1 && path.endsWith('/'))
    path = path.slice(0, -1)
  if (path === '/')
    path = ''

  const query = keptParams.length > 0 ? `?${keptParams.join('&')}` : ''
  return `${host}${path}${query}`
}

export function deriveSourceType(url: string): SourceType {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  }
  catch {
    return DEFAULT_TYPE
  }
  if (host.startsWith('www.'))
    host = host.slice(4)
  const key = hostKey(host)
  return key ? HOST_RULES[key]!.type : DEFAULT_TYPE
}

/** Extract external http(s) URLs from raw markdown (links, autolinks, bare URLs). */
export function extractUrls(markdown: string): string[] {
  const matches = markdown.match(/https?:\/\/[^\s)<>"'\]]+/g) ?? []
  return matches.map(url => url.replace(/[.,;:!?]+$/, ''))
}
