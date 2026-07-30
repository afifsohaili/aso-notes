import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import SyncedFolderManager from '../../app/components/settings/synced-folder-manager.vue'

describe('synced-folder-manager', () => {
  it('renders folder paths and note counts', async () => {
    const component = await mountSuspended(SyncedFolderManager, {
      props: {
        folders: [
          { id: 'folder-1', path: '/notes/personal', noteCount: 3 },
          { id: 'folder-2', path: '/notes/work', noteCount: 0 },
        ],
      },
    })

    expect(component.text()).toContain('/notes/personal')
    expect(component.text()).toContain('/notes/work')
    expect(component.text()).toContain('3 notes synced')
    expect(component.text()).toContain('0 notes synced')
  })

  it('opens a type-to-confirm dialog when the remove button is clicked', async () => {
    const component = await mountSuspended(SyncedFolderManager, {
      props: {
        folders: [{ id: 'folder-1', path: '/notes/personal', noteCount: 3 }],
      },
    })

    await component.find('[data-testid="folder-delete-button"]').trigger('click')

    expect(component.text()).toContain('Remove synced folder?')
    expect(component.text()).toContain('/notes/personal')
    expect(component.text()).toContain('3')

    const confirmButton = component.find('[data-testid="folder-remove-confirm-button"]')
    expect(confirmButton.attributes('disabled')).toBeDefined()
  })

  it('enables confirm only after typing REMOVE', async () => {
    const component = await mountSuspended(SyncedFolderManager, {
      props: {
        folders: [{ id: 'folder-1', path: '/notes/personal', noteCount: 1 }],
      },
    })

    await component.find('[data-testid="folder-delete-button"]').trigger('click')

    const input = component.find('[data-testid="folder-remove-confirm-input"]')
    await input.setValue('remove')

    let confirmButton = component.find('[data-testid="folder-remove-confirm-button"]')
    expect(confirmButton.attributes('disabled')).toBeDefined()

    await input.setValue('REMOVE')

    confirmButton = component.find('[data-testid="folder-remove-confirm-button"]')
    expect(confirmButton.attributes('disabled')).toBeUndefined()
  })

  it('emits delete when confirmed and closes the dialog', async () => {
    const component = await mountSuspended(SyncedFolderManager, {
      props: {
        folders: [{ id: 'folder-1', path: '/notes/personal', noteCount: 1 }],
      },
    })

    await component.find('[data-testid="folder-delete-button"]').trigger('click')
    await component.find('[data-testid="folder-remove-confirm-input"]').setValue('REMOVE')
    await component.find('[data-testid="folder-remove-confirm-button"]').trigger('click')

    expect(component.emitted('delete')).toHaveLength(1)
    expect(component.emitted('delete')?.[0]).toEqual(['folder-1'])
    expect(component.find('[data-testid="folder-remove-confirm-input"]').exists()).toBe(false)
  })

  it('closes the dialog without emitting when cancelled', async () => {
    const component = await mountSuspended(SyncedFolderManager, {
      props: {
        folders: [{ id: 'folder-1', path: '/notes/personal', noteCount: 1 }],
      },
    })

    await component.find('[data-testid="folder-delete-button"]').trigger('click')
    await component.find('[data-testid="folder-remove-cancel-button"]').trigger('click')

    expect(component.emitted('delete')).toBeUndefined()
    expect(component.find('[data-testid="folder-remove-confirm-input"]').exists()).toBe(false)
  })
})
