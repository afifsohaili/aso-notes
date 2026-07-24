import { describe, expect, it } from 'vitest'
import { buildFolderTree } from '../../server/lib/notes/tree'

describe('buildFolderTree', () => {
  it('builds a nested tree from flat folder paths', () => {
    const folders = [
      { path: '/project-a', hasCover: false, noteCount: 2 },
      { path: '/project-a/engineering', hasCover: true, noteCount: 1 },
      { path: '/project-b', hasCover: false, noteCount: 0 },
    ]
    const tree = buildFolderTree(folders)

    expect(tree).toHaveLength(2)
    expect(tree[0]).toMatchObject({ name: 'project-a', path: '/project-a', hasCover: false, noteCount: 2 })
    expect(tree[1]).toMatchObject({ name: 'project-b', path: '/project-b', hasCover: false, noteCount: 0 })

    expect(tree[0]!.children).toHaveLength(1)
    expect(tree[0]!.children[0]).toMatchObject({ name: 'engineering', path: '/project-a/engineering', hasCover: true, noteCount: 1 })
  })

  it('sorts folders by name at each level', () => {
    const folders = [
      { path: '/zebra', hasCover: false, noteCount: 0 },
      { path: '/alpha', hasCover: false, noteCount: 0 },
      { path: '/beta', hasCover: false, noteCount: 0 },
    ]
    const tree = buildFolderTree(folders)
    expect(tree.map(n => n.name)).toEqual(['alpha', 'beta', 'zebra'])
  })

  it('returns an empty array when no folders exist', () => {
    expect(buildFolderTree([])).toEqual([])
  })

  it('places children under an existing parent even when input is unordered', () => {
    const folders = [
      { path: '/a/b/c', hasCover: false, noteCount: 0 },
      { path: '/a', hasCover: false, noteCount: 0 },
      { path: '/a/b', hasCover: false, noteCount: 0 },
    ]
    const tree = buildFolderTree(folders)
    expect(tree).toHaveLength(1)
    expect(tree[0]!.children).toHaveLength(1)
    expect(tree[0]!.children[0]!.children).toHaveLength(1)
  })

  it('treats a folder without a known parent as a top-level node', () => {
    const folders = [
      { path: '/a/b', hasCover: false, noteCount: 0 },
    ]
    const tree = buildFolderTree(folders)
    expect(tree).toHaveLength(1)
    expect(tree[0]!.path).toBe('/a/b')
    expect(tree[0]!.children).toEqual([])
  })
})
