import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import AppHeader from '../../app/components/app-header.vue'

const { useSessionMock } = vi.hoisted(() => ({
  useSessionMock: vi.fn(),
}))

mockNuxtImport('useSession', () => useSessionMock)

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
})
