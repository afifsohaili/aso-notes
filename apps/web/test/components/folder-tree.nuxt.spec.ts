import type { FolderNode } from '../../app/components/notes/folder-tree.vue'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import FolderTree from '../../app/components/notes/folder-tree.vue'

const TREE: FolderNode[] = [
  {
    name: 'aso-notes',
    path: '/aso-notes',
    hasCover: true,
    noteCount: 2,
    children: [
      { name: '002-system', path: '/aso-notes/002-system', hasCover: false, noteCount: 1, children: [] },
      { name: '003-topics-concepts', path: '/aso-notes/003-topics-concepts', hasCover: false, noteCount: 1, children: [] },
    ],
  },
  { name: 'projexn', path: '/projexn', hasCover: false, noteCount: 1, children: [
    { name: 'billing', path: '/projexn/billing', hasCover: false, noteCount: 3, children: [] },
  ] },
]

describe('folder-tree', () => {
  it('collapses everything by default when nothing is selected', async () => {
    const component = await mountSuspended(FolderTree, {
      props: { folders: TREE, selectedPath: null },
    })

    expect(component.text()).toContain('aso-notes')
    expect(component.text()).not.toContain('002-system')
  })

  it('auto-expands ancestors of the selected path', async () => {
    const component = await mountSuspended(FolderTree, {
      props: { folders: TREE, selectedPath: '/aso-notes/003-topics-concepts' },
    })

    expect(component.text()).toContain('002-system')
    expect(component.text()).toContain('003-topics-concepts')
    expect(component.text()).not.toContain('billing')
  })

  it('keeps the parent expanded when the selection moves to a sibling folder', async () => {
    const component = await mountSuspended(FolderTree, {
      props: { folders: TREE, selectedPath: '/aso-notes/004-extraction' },
    })
    expect(component.text()).toContain('002-system')

    await component.setProps({ selectedPath: '/aso-notes/002-system' })
    expect(component.text()).toContain('002-system')
    expect(component.text()).toContain('003-topics-concepts')
  })

  it('toggles a branch open and closed on chevron click', async () => {
    const component = await mountSuspended(FolderTree, {
      props: { folders: TREE, selectedPath: null },
    })

    expect(component.text()).not.toContain('billing')
    const projexnRow = component.findAll('[data-testid="folder-tree-row"]')
      .find(row => row.text().includes('projexn'))
    await projexnRow?.find('button').trigger('click')
    expect(component.text()).toContain('billing')

    await projexnRow?.find('button').trigger('click')
    expect(component.text()).not.toContain('billing')
  })

  it('lets an explicit collapse override the ancestor default', async () => {
    const component = await mountSuspended(FolderTree, {
      props: { folders: TREE, selectedPath: '/aso-notes/003-topics-concepts' },
    })
    expect(component.text()).toContain('002-system')

    const parentRow = component.findAll('[data-testid="folder-tree-row"]')
      .find(row => row.text().includes('aso-notes'))
    await parentRow?.find('button').trigger('click')
    expect(component.text()).not.toContain('002-system')
  })
})
