import type { SyncedFolderGroup } from '../../app/components/notes/notes-layout.vue'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import NotesLayout from '../../app/components/notes/notes-layout.vue'

function makeGroup(overrides: Partial<SyncedFolderGroup> = {}): SyncedFolderGroup {
  return {
    syncedFolderId: 'sf-1',
    name: 'plans',
    pathPrefix: null,
    absolutePath: '/Users/afifsohaili/Projects/justjom',
    hasCover: false,
    noteCount: 3,
    children: [],
    ...overrides,
  }
}

const baseProps = {
  groups: [] as SyncedFolderGroup[],
  selectedSyncedFolderId: null,
  selectedFolderPath: null,
  selectedNotePath: null,
  notes: [],
  note: null,
}

describe('notes-layout synced folder labels', () => {
  it('renders a gray path prefix before the name when pathPrefix is set', async () => {
    const component = await mountSuspended(NotesLayout, {
      props: {
        ...baseProps,
        groups: [makeGroup({ pathPrefix: 'justjom/' })],
      },
    })

    const row = component.find('[data-testid="folder-tree-row"]')
    const prefix = row.find('span.shrink-0.text-gray-400')
    expect(prefix.exists()).toBe(true)
    expect(prefix.text()).toBe('justjom/')
    expect(row.text()).toContain('plans')
  })

  it('renders the name only when pathPrefix is null', async () => {
    const component = await mountSuspended(NotesLayout, {
      props: {
        ...baseProps,
        groups: [makeGroup({ pathPrefix: null })],
      },
    })

    const row = component.find('[data-testid="folder-tree-row"]')
    expect(row.find('span.shrink-0.text-gray-400').exists()).toBe(false)
    expect(row.text()).toContain('plans')
  })

  it('sets the absolute path as the title tooltip on the root row', async () => {
    const component = await mountSuspended(NotesLayout, {
      props: {
        ...baseProps,
        groups: [makeGroup({ absolutePath: '/Users/afifsohaili/Projects/justjom' })],
      },
    })

    const row = component.find('[data-testid="folder-tree-row"]')
    expect(row.attributes('title')).toBe('/Users/afifsohaili/Projects/justjom')
  })
})
