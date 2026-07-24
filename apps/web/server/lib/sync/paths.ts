import path from 'node:path'

/**
 * Path helpers for the sync service. Note/folder paths are workspace-relative
 * POSIX strings with a leading slash ('/project-a/engineering/x.md'); '/'
 * denotes the workspace root. Folders are a path-string model — no parent_id
 * (plan-002-system data model, M1 migration).
 */

/** A Folder Cover file is never a Note; its content lives on the folders row. */
export const FOLDER_COVER_FILENAME = '__folder-cover.md'

/** Absolute file path → workspace-relative note path ('/a/b/x.md'). */
export function toNotePath(notesDir: string, absolutePath: string): string {
  const rel = path.relative(notesDir, absolutePath)
  return `/${rel.split(path.sep).join('/')}`
}

/** Immediate parent folder path of a note/folder path ('/a/b' → '/a', '/a' → '/'). */
export function folderPathOf(notePath: string): string {
  if (notePath === '/')
    return '/'
  const parent = notePath.replace(/\/[^/]+$/, '')
  return parent === '' ? '/' : parent
}

/**
 * Every directory level of a note path, root-level first, excluding the root
 * itself — root notes have no folder row (M1 divergence note).
 * '/a/b/c.md' → ['/a', '/a/b'].
 */
export function ancestorFolderPaths(notePath: string): string[] {
  const segments = notePath.split('/').filter(Boolean)
  segments.pop() // drop the filename
  const folders: string[] = []
  for (let i = 1; i <= segments.length; i++)
    folders.push(`/${segments.slice(0, i).join('/')}`)
  return folders
}

/** True when the path's basename is the folder-cover filename, at any depth. */
export function isFolderCoverPath(notePath: string): boolean {
  return notePath.split('/').pop() === FOLDER_COVER_FILENAME
}

/** Note title from its path: filename without the extension. */
export function titleFromPath(notePath: string): string {
  const base = notePath.split('/').pop() ?? notePath
  return base.replace(/\.[^.]+$/, '')
}
