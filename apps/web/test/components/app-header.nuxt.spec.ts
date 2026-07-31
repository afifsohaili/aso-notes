import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import AppHeader from '../../app/components/app-header.vue'

const { useSessionMock, useRouteMock, makeRoute } = vi.hoisted(() => {
  const makeRoute = (path = '/') => ({
    path,
    fullPath: path,
    hash: '',
    query: {},
    params: {},
    meta: {},
    matched: [],
    redirectedFrom: undefined,
    name: undefined,
  })
  return {
    useSessionMock: vi.fn(),
    useRouteMock: vi.fn(() => makeRoute()),
    makeRoute,
  }
})

mockNuxtImport('useSession', () => useSessionMock)
mockNuxtImport('useRoute', () => useRouteMock)

describe('app-header', () => {
  it('renders the brand wordmark', async () => {
    useSessionMock.mockResolvedValue({ session: null })
    const component = await mountSuspended(AppHeader)
    expect(component.text()).toContain('aso-notes')
  })

  it('shows nav links to chat, notes, queue, graph, and settings when signed in', async () => {
    useSessionMock.mockResolvedValue({ session: { user: { id: 'u1' } } })
    const component = await mountSuspended(AppHeader)

    const hrefs = component.findAll('a').map(a => a.attributes('href'))
    expect(hrefs).toContain('/chat')
    expect(hrefs).toContain('/notes')
    expect(hrefs).toContain('/notes/queue')
    expect(hrefs).toContain('/graph')
    expect(hrefs).toContain('/settings')
  })

  it('hides nav links when signed out', async () => {
    useSessionMock.mockResolvedValue({ session: null })
    const component = await mountSuspended(AppHeader)

    const hrefs = component.findAll('a').map(a => a.attributes('href'))
    expect(hrefs).not.toContain('/chat')
    expect(hrefs).not.toContain('/notes')
    expect(hrefs).not.toContain('/notes/queue')
    expect(hrefs).not.toContain('/graph')
    expect(hrefs).not.toContain('/settings')
  })

  it('highlights only the queue link on /notes/queue, not the notes link', async () => {
    useSessionMock.mockResolvedValue({ session: { user: { id: 'u1' } } })
    useRouteMock.mockReturnValue(makeRoute('/notes/queue'))
    const component = await mountSuspended(AppHeader)

    const notesLink = component.findAll('a').find(a => a.attributes('href') === '/notes')
    const queueLink = component.findAll('a').find(a => a.attributes('href') === '/notes/queue')
    expect(notesLink?.classes()).not.toContain('underline')
    expect(queueLink?.classes()).toContain('underline')
  })

  it('highlights the notes link on /notes', async () => {
    useSessionMock.mockResolvedValue({ session: { user: { id: 'u1' } } })
    useRouteMock.mockReturnValue(makeRoute('/notes'))
    const component = await mountSuspended(AppHeader)

    const notesLink = component.findAll('a').find(a => a.attributes('href') === '/notes')
    const queueLink = component.findAll('a').find(a => a.attributes('href') === '/notes/queue')
    expect(notesLink?.classes()).toContain('underline')
    expect(queueLink?.classes()).not.toContain('underline')
  })

  it('renders an icon inside every nav link', async () => {
    useSessionMock.mockResolvedValue({ session: { user: { id: 'u1' } } })
    const component = await mountSuspended(AppHeader)

    const navLinks = component.findAll('nav a')
    expect(navLinks.length).toBe(5)
    for (const link of navLinks) {
      expect(link.find('svg').exists()).toBe(true)
    }
  })

  it('gives inactive links a visible hover background', async () => {
    useSessionMock.mockResolvedValue({ session: { user: { id: 'u1' } } })
    useRouteMock.mockReturnValue(makeRoute('/chat'))
    const component = await mountSuspended(AppHeader)

    const inactive = component.findAll('nav a').filter(a => !a.classes().includes('underline'))
    expect(inactive.length).toBeGreaterThan(0)
    for (const link of inactive) {
      expect(link.classes()).toContain('hover:bg-gray-100')
    }
  })
})
