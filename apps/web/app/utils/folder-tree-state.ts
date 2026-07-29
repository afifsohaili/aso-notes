/**
 * Folder-tree expansion state helpers.
 *
 * Expansion is a map of folder path → explicit override. When no override
 * exists, the default is: expanded iff the folder is the selected folder or
 * one of its ancestors (so deep links and sibling navigation keep the branch
 * open). An explicit toggle always wins over the default.
 */
export type FolderExpansionState = Record<string, boolean>

export function isFolderExpanded(
  state: FolderExpansionState,
  path: string,
  selectedPath: string | null,
): boolean {
  const explicit = state[path]
  if (explicit !== undefined)
    return explicit
  if (!selectedPath)
    return false
  const prefix = path.endsWith('/') ? path : `${path}/`
  return selectedPath === path || selectedPath.startsWith(prefix)
}

export function toggleFolderExpanded(
  state: FolderExpansionState,
  path: string,
  selectedPath: string | null,
): FolderExpansionState {
  return { ...state, [path]: !isFolderExpanded(state, path, selectedPath) }
}
