import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import SettingsLayout from '../../app/layouts/settings.vue'

const { useRouteMock, makeRoute } = vi.hoisted(() => {
  function makeRoute(path: string) {
    return {
      path,
      fullPath: path,
      hash: '',
      query: {},
      params: {},
      meta: {},
      matched: [],
      redirectedFrom: undefined,
      name: undefined,
    }
  }
  return {
    useRouteMock: vi.fn(() => makeRoute('/settings/folders')),
    makeRoute,
  }
})

mockNuxtImport('useRoute', () => useRouteMock)

describe('settings layout', () => {
  it('renders all sidebar nav sections on desktop', async () => {
    useRouteMock.mockReturnValue(makeRoute('/settings/folders'))
    const component = await mountSuspended(SettingsLayout, {
      slots: { default: '<div data-testid="page-content">Page content</div>' },
    })

    const sidebar = component.find('nav[aria-label="Settings sections"]')
    expect(sidebar.exists()).toBe(true)
    expect(sidebar.text()).toContain('Synced Folders')
    expect(sidebar.text()).toContain('AI Models')
    expect(sidebar.text()).toContain('Extraction')
    expect(sidebar.text()).toContain('Consolidation')
  })

  it('highlights the active section based on the route', async () => {
    useRouteMock.mockReturnValue(makeRoute('/settings/extraction'))
    const component = await mountSuspended(SettingsLayout, {
      slots: { default: '<div data-testid="page-content">Page content</div>' },
    })

    const sidebar = component.findAll('nav[aria-label="Settings sections"]').find(n => !n.classes().includes('md:hidden'))
    const active = sidebar?.findAll('a').find(a => a.text() === 'Extraction')
    expect(active?.classes()).toContain('bg-indigo-50')
    expect(active?.classes()).toContain('text-indigo-700')
  })

  it('renders a horizontal scrollable nav on mobile', async () => {
    useRouteMock.mockReturnValue(makeRoute('/settings/folders'))
    const component = await mountSuspended(SettingsLayout, {
      slots: { default: '<div data-testid="page-content">Page content</div>' },
    })

    const mobileNav = component.findAll('nav[aria-label="Settings sections"]').find(n => n.classes().includes('md:hidden'))
    expect(mobileNav?.exists()).toBe(true)
    expect(mobileNav?.findAll('a').length).toBe(4)
  })

  it('renders the page slot', async () => {
    useRouteMock.mockReturnValue(makeRoute('/settings/folders'))
    const component = await mountSuspended(SettingsLayout, {
      slots: { default: '<div data-testid="page-content">Page content</div>' },
    })

    expect(component.find('[data-testid="page-content"]').exists()).toBe(true)
  })
})
