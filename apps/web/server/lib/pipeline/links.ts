/**
 * Wikilink + internal markdown link parsing (plan §data model `links`).
 * Pure seam: given raw note content and the note's own path, produce the
 * distinct internal link targets with the candidate note paths each target
 * may resolve to. DB resolution lives in the extract-links stage.
 */

export interface ParsedNoteLink {
  /** The target as written in the note (alias/heading stripped). */
  rawTarget: string
  /** Candidate `notes.path` values to resolve against, most specific first. */
  candidates: string[]
}

const WIKILINK_RE = /\[\[([^\][|]+)(?:\|[^\][]*)?\]\]/g
const MD_LINK_RE = /(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i
const EXT_RE = /\.[a-z0-9]+$/i

function stripFragment(target: string): string {
  return target.split('#')[0]!.trim()
}

/** dirname in the path-string model ('/proj/a.md' → '/proj', '/a.md' → '/'). */
function dirOf(path: string): string {
  const dir = path.replace(/\/[^/]+$/, '')
  return dir === '' ? '/' : dir
}

/** Resolve '.'/'..' segments, collapse duplicate slashes, guarantee a leading '/'. */
function normalizePath(path: string): string {
  const segments: string[] = []
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.')
      continue
    if (segment === '..') {
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  return `/${segments.join('/')}`
}

/**
 * Candidate paths for a written target, most specific first. Absolute targets
 * resolve from the root; relative targets resolve against the note's own
 * folder first, then the root. Extensionless targets also try '.md'.
 */
export function resolveLinkCandidates(rawTarget: string, notePath: string): string[] {
  const target = stripFragment(rawTarget)
  const base = target.startsWith('/') ? target : `${dirOf(notePath)}/${target}`
  const primary = normalizePath(base)

  const candidates: string[] = []
  const push = (path: string) => {
    if (!candidates.includes(path))
      candidates.push(path)
  }

  const withMdFallback = (path: string) => {
    push(path)
    if (!EXT_RE.test(path))
      push(`${path}.md`)
  }

  withMdFallback(primary)
  if (!target.startsWith('/'))
    withMdFallback(normalizePath(`/${target}`))
  return candidates
}

function isInternalMarkdownTarget(target: string): boolean {
  return !SCHEME_RE.test(target) && !target.startsWith('//') && !target.startsWith('#')
}

/**
 * Extract the distinct internal link targets from raw markdown: wikilinks
 * (`[[target]]`, `[[target|alias]]`) and markdown links whose target is not
 * an external URL, anchor, or image. First occurrence order; duplicates
 * (same resolved candidate set) are dropped.
 */
export function parseNoteLinks(content: string, notePath: string): ParsedNoteLink[] {
  const links: ParsedNoteLink[] = []
  const seen = new Set<string>()

  const push = (rawTarget: string) => {
    const target = stripFragment(rawTarget)
    if (!target)
      return
    const candidates = resolveLinkCandidates(target, notePath)
    const key = candidates.join('')
    if (seen.has(key))
      return
    seen.add(key)
    links.push({ rawTarget: target, candidates })
  }

  for (const match of content.matchAll(WIKILINK_RE))
    push(match[1]!)

  for (const match of content.matchAll(MD_LINK_RE)) {
    const target = match[1]!.trim()
    if (isInternalMarkdownTarget(target))
      push(target)
  }

  return links
}
