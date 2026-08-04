import path from 'node:path'

export interface SyncedFolderRoot {
  id: string
  path: string
  alias: string | null
}

/**
 * Root display name of a Synced Folder: `alias ?? basename(path)`.
 * An empty/blank alias is treated as unset; a set alias is returned trimmed.
 */
export function rootNameFor(syncedFolderPath: string, alias: string | null | undefined): string {
  if (alias && alias.trim().length > 0)
    return alias.trim()
  return path.basename(syncedFolderPath)
}

/**
 * Ancestor segment names of a path, top-most first.
 * `/Users/x/Projects/justjom/plans` → `['Users', 'x', 'Projects', 'justjom']`.
 * A root-level path such as `/plans` → `[]`.
 */
function ancestorSegments(folderPath: string): string[] {
  const segments: string[] = []
  let dir = path.dirname(folderPath)
  while (dir !== folderPath && dir !== path.parse(dir).root && dir !== '.') {
    segments.push(path.basename(dir))
    dir = path.dirname(dir)
  }
  return segments.reverse()
}

/**
 * Minimal distinguishing parent segments for a root among a colliding group,
 * with a trailing slash (e.g. `justjom/`). Walks up from the immediate parent
 * until the segment sequence is unique within the group. Returns null when the
 * root has no parent segments to draw from.
 */
function distinguishingPrefix(folderPath: string, groupPaths: string[]): string | null {
  const segments = ancestorSegments(folderPath)
  const prefixes = new Map(groupPaths.map(other => [other, ancestorSegments(other)]))
  for (let depth = 1; depth <= segments.length; depth++) {
    const candidate = segments.slice(-depth).join('/')
    const unique = groupPaths.every((other) => {
      if (other === folderPath)
        return true
      return prefixes.get(other)!.slice(-depth).join('/') !== candidate
    })
    if (unique)
      return `${candidate}/`
  }
  return segments.length > 0 ? `${segments.join('/')}/` : null
}

/**
 * Compute the `pathPrefix` for every Synced Folder root of a workspace.
 *
 * Only roots whose basename collides with another root that also has no alias
 * are disambiguated. Roots with an alias set are excluded from the collision
 * set and always yield null. Returns a map keyed by root id.
 */
export function computePathPrefixes(roots: SyncedFolderRoot[]): Map<string, string | null> {
  const prefixById = new Map<string, string | null>(roots.map(r => [r.id, null]))

  const unaliasedById = new Map(roots.filter(r => r.alias === null).map(r => [r.id, r]))

  const groups = new Map<string, string[]>()
  for (const r of unaliasedById.values()) {
    const basename = path.basename(r.path)
    const list = groups.get(basename) ?? []
    list.push(r.id)
    groups.set(basename, list)
  }

  for (const ids of groups.values()) {
    if (ids.length < 2)
      continue
    const groupRoots = ids.map(id => unaliasedById.get(id)!)
    const groupPaths = groupRoots.map(r => r.path)
    for (const r of groupRoots) {
      prefixById.set(r.id, distinguishingPrefix(r.path, groupPaths))
    }
  }

  return prefixById
}
