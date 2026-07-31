import { folderPathOf } from '../sync/paths'

export interface FolderTreeInput {
  path: string
  hasCover: boolean
  noteCount: number
}

export interface FolderNode {
  name: string
  path: string
  hasCover: boolean
  noteCount: number
  children: FolderNode[]
}

function folderName(path: string): string {
  if (path === '/')
    return 'root'
  return path.split('/').pop() ?? path
}

/**
 * Build a nested folder tree from flat folder rows. Folders are linked by
 * their path-string parent (folderPathOf). Any folder whose parent is not in
 * the input becomes a top-level node. Children are sorted by name. The root
 * path `/` is named `root` so an empty-name node is never emitted.
 */
export function buildFolderTree(folders: FolderTreeInput[]): FolderNode[] {
  const byPath = new Map<string, FolderNode>()
  const roots: FolderNode[] = []

  // Sort by depth so parents are created before children.
  const sorted = [...folders].sort((a, b) => a.path.split('/').length - b.path.split('/').length)

  for (const folder of sorted) {
    const name = folderName(folder.path)
    const node: FolderNode = {
      name,
      path: folder.path,
      hasCover: folder.hasCover,
      noteCount: folder.noteCount,
      children: [],
    }
    byPath.set(folder.path, node)

    const parentPath = folderPathOf(folder.path)
    const parent = byPath.get(parentPath)
    if (parent && parentPath !== folder.path) {
      parent.children.push(node)
    }
    else {
      roots.push(node)
    }
  }

  for (const node of byPath.values()) {
    node.children.sort((a, b) => a.name.localeCompare(b.name))
  }
  roots.sort((a, b) => a.name.localeCompare(b.name))

  return roots
}
