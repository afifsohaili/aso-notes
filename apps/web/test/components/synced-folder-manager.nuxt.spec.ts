import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import SyncedFolderManager from '../../app/components/settings/synced-folder-manager.vue'

describe('synced-folder-manager', () => {
  it('renders folder paths and note counts', async () => {
    const component = await mountSuspended(SyncedFolderManager, {
      props: {
        folders: [
          { id: 'folder-1', path: '/notes/personal', basename: 'personal', noteCount: 3 },
          { id: 'folder-2', path: '/notes/work', basename: 'work', noteCount: 0 },
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
        folders: [{ id: 'folder-1', path: '/notes/personal', basename: 'personal', noteCount: 3 }],
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
        folders: [{ id: 'folder-1', path: '/notes/personal', basename: 'personal', noteCount: 1 }],
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
        folders: [{ id: 'folder-1', path: '/notes/personal', basename: 'personal', noteCount: 1 }],
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
        folders: [{ id: 'folder-1', path: '/notes/personal', basename: 'personal', noteCount: 1 }],
      },
    })

    await component.find('[data-testid="folder-delete-button"]').trigger('click')
    await component.find('[data-testid="folder-remove-cancel-button"]').trigger('click')

    expect(component.emitted('delete')).toBeUndefined()
    expect(component.find('[data-testid="folder-remove-confirm-input"]').exists()).toBe(false)
  })
})

describe('synced-folder-manager alias labels', () => {
  it('renders a bold basename with a gray parent path', async () => {
    const component = await mountSuspended(SyncedFolderManager, {
      props: {
        folders: [{ id: 'folder-1', path: '/Users/afifsohaili/Projects/justjom/', basename: 'justjom', noteCount: 3 }],
      },
    })

    const parent = component.find('[data-testid="folder-parent-path"]')
    expect(parent.exists()).toBe(true)
    expect(parent.text()).toBe('/Users/afifsohaili/Projects/')
    const name = component.find('[data-testid="folder-name"]')
    expect(name.text()).toBe('justjom')
    expect(name.classes()).toContain('font-semibold')
  })

  it('keeps the basename visible and shows the alias as a secondary element when one is set', async () => {
    const component = await mountSuspended(SyncedFolderManager, {
      props: {
        folders: [{ id: 'folder-1', path: '/Users/afifsohaili/Projects/justjom/', basename: 'justjom', noteCount: 3, alias: 'JustJom' }],
      },
    })

    expect(component.find('[data-testid="folder-name"]').text()).toBe('justjom')
    expect(component.text()).toContain('justjom')
    const alias = component.find('[data-testid="folder-alias"]')
    expect(alias.exists()).toBe(true)
    expect(alias.text()).toContain('JustJom')
  })

  it('sets the full path as the title tooltip on the row label', async () => {
    const component = await mountSuspended(SyncedFolderManager, {
      props: {
        folders: [{ id: 'folder-1', path: '/Users/afifsohaili/Projects/justjom/', basename: 'justjom', noteCount: 3 }],
      },
    })

    expect(component.find('p[data-testid="folder-label"]').attributes('title')).toBe('/Users/afifsohaili/Projects/justjom/')
  })
})

describe('synced-folder-manager alias editing', () => {
  it('emits saveAlias with the entered alias when saved', async () => {
    const component = await mountSuspended(SyncedFolderManager, {
      props: {
        folders: [{ id: 'folder-1', path: '/Users/afifsohaili/Projects/justjom/', basename: 'justjom', noteCount: 3 }],
      },
    })

    await component.find('[data-testid="alias-edit-button"]').trigger('click')
    await component.find('[data-testid="alias-input"]').setValue('Work Plans')
    await component.find('[data-testid="alias-save-button"]').trigger('click')

    expect(component.emitted('saveAlias')).toHaveLength(1)
    expect(component.emitted('saveAlias')?.[0]).toEqual(['folder-1', 'Work Plans'])
    expect(component.find('[data-testid="alias-input"]').exists()).toBe(false)
  })

  it('sends null when the alias input is empty', async () => {
    const component = await mountSuspended(SyncedFolderManager, {
      props: {
        folders: [{ id: 'folder-1', path: '/Users/afifsohaili/Projects/justjom/', basename: 'justjom', noteCount: 3, alias: 'Work' }],
      },
    })

    await component.find('[data-testid="alias-edit-button"]').trigger('click')
    const input = component.find('[data-testid="alias-input"]')
    expect(input.element.value).toBe('Work')
    await input.setValue('   ')
    await component.find('[data-testid="alias-save-button"]').trigger('click')

    expect(component.emitted('saveAlias')?.[0]).toEqual(['folder-1', null])
  })

  it('cancels alias editing on Escape without emitting', async () => {
    const component = await mountSuspended(SyncedFolderManager, {
      props: {
        folders: [{ id: 'folder-1', path: '/Users/afifsohaili/Projects/justjom/', basename: 'justjom', noteCount: 3 }],
      },
    })

    await component.find('[data-testid="alias-edit-button"]').trigger('click')
    await component.find('[data-testid="alias-input"]').trigger('keydown.esc')

    expect(component.find('[data-testid="alias-input"]').exists()).toBe(false)
    expect(component.emitted('saveAlias')).toBeUndefined()
  })
})
