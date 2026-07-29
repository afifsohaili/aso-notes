import type { FolderExpansionState } from '~/utils/folder-tree-state'
import { isFolderExpanded, toggleFolderExpanded } from '~/utils/folder-tree-state'

/**
 * Shared, navigation-persistent expansion state for the notes folder tree.
 * Backed by Nuxt `useState`, so it survives page navigations in-session
 * (unlike component-local refs, which reset on every universal render).
 */
export function useExpandedFolders() {
  const state = useState<FolderExpansionState>('notes-folder-tree-expanded', () => ({}))

  function isExpanded(path: string, selectedPath: string | null): boolean {
    return isFolderExpanded(state.value, path, selectedPath)
  }

  function toggle(path: string, selectedPath: string | null): void {
    state.value = toggleFolderExpanded(state.value, path, selectedPath)
  }

  return { isExpanded, toggle }
}
