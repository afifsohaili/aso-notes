import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import SettingsLayout from '../../app/layouts/settings.vue'

const { useRouteMock, useFetchMock, makeRoute } = vi.hoisted(() => {
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
    useFetchMock: vi.fn(),
    makeRoute,
  }
})

mockNuxtImport('useRoute', () => useRouteMock)
mockNuxtImport('useFetch', () => useFetchMock)

function mockBadge(visible: boolean) {
  useFetchMock.mockImplementation((url: unknown) => {
    if (url === '/api/consolidation/badge')
      return { data: ref({ badge: visible, latestRunId: null }) }
    return { data: ref(null) }
  })
}

describe('settings layout', () => {
  it('renders all sidebar nav sections on desktop', async () => {
    useRouteMock.mockReturnValue(makeRoute('/settings/folders'))
    mockBadge(false)
    const component = await mountSuspended(SettingsLayout, {
      slots: { default: '<div data-testid="page-content">Page content</div>' },
    })

    const sidebar = component.find('nav[aria-label="Settings sections"]')
    expect(sidebar.exists()).toBe(true)
    expect(sidebar.text()).toContain('Synced Folders')
    expect(sidebar.text()).toContain('AI Models')
    expect(sidebar.text()).toContain('Extraction')
    expect(sidebar.text()).toContain('Consolidation')
    expect(sidebar.text()).toContain('Usage')
  })

  it('highlights the active section based on the route', async () => {
    useRouteMock.mockReturnValue(makeRoute('/settings/usage'))
    mockBadge(false)
    const component = await mountSuspended(SettingsLayout, {
      slots: { default: '<div data-testid="page-content">Page content</div>' },
    })

    const sidebar = component.findAll('nav[aria-label="Settings sections"]').find(n => !n.classes().includes('md:hidden'))
    const active = sidebar?.findAll('a').find(a => a.text() === 'Usage')
    expect(active?.classes()).toContain('bg-indigo-50')
    expect(active?.classes()).toContain('text-indigo-700')
  })

  it('renders a horizontal scrollable nav on mobile', async () => {
    useRouteMock.mockReturnValue(makeRoute('/settings/folders'))
    mockBadge(false)
    const component = await mountSuspended(SettingsLayout, {
      slots: { default: '<div data-testid="page-content">Page content</div>' },
    })

    const mobileNav = component.findAll('nav[aria-label="Settings sections"]').find(n => n.classes().includes('md:hidden'))
    expect(mobileNav?.exists()).toBe(true)
    expect(mobileNav?.findAll('a').length).toBe(5)
  })

  it('renders the page slot', async () => {
    useRouteMock.mockReturnValue(makeRoute('/settings/folders'))
    mockBadge(false)
    const component = await mountSuspended(SettingsLayout, {
      slots: { default: '<div data-testid="page-content">Page content</div>' },
    })

    expect(component.find('[data-testid="page-content"]').exists()).toBe(true)
  })

  it('shows a badge on the Consolidation nav item when the latest run failed or is flagged', async () => {
    useRouteMock.mockReturnValue(makeRoute('/settings/folders'))
    mockBadge(true)
    const component = await mountSuspended(SettingsLayout, {
      slots: { default: '<div data-testid="page-content">Page content</div>' },
    })

    const badges = component.findAll('[data-testid="consolidation-nav-badge"]')
    expect(badges.length).toBeGreaterThan(0)
    expect(badges.every(b => b.classes().includes('bg-red-500'))).toBe(true)
  })

  it('hides the badge when no run needs attention', async () => {
    useRouteMock.mockReturnValue(makeRoute('/settings/folders'))
    mockBadge(false)
    const component = await mountSuspended(SettingsLayout, {
      slots: { default: '<div data-testid="page-content">Page content</div>' },
    })

    expect(component.find('[data-testid="consolidation-nav-badge"]').exists()).toBe(false)
  })
})
