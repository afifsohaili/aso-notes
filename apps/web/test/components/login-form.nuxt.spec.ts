import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LoginForm from '../../app/components/auth/login-form.vue'

const { useAuthClientMock, navigateToMock } = vi.hoisted(() => ({
  useAuthClientMock: vi.fn(),
  navigateToMock: vi.fn(),
}))

mockNuxtImport('useAuthClient', () => useAuthClientMock)
mockNuxtImport('navigateTo', () => navigateToMock)

beforeEach(() => {
  useAuthClientMock.mockClear()
  navigateToMock.mockClear()
})

function mockSignIn(response: { error?: { message: string } | null, data?: unknown }) {
  useAuthClientMock.mockReturnValue({
    signIn: { email: vi.fn().mockResolvedValue(response) },
  })
}

async function fillAndSubmit(component: Awaited<ReturnType<typeof mountSuspended>>) {
  const emailInput = component.find('input#email')
  const passwordInput = component.find('input#password')
  await emailInput.setValue('test@example.com')
  await passwordInput.setValue('password123')
  await component.find('form').trigger('submit')
}

describe('login-form', () => {
  it('shows an error toast with the server message on login failure', async () => {
    mockSignIn({ error: { message: 'Invalid credentials' } })

    const component = await mountSuspended(LoginForm)
    await fillAndSubmit(component)
    await flushPromises()

    expect(component.text()).toContain('Invalid credentials')
    expect(navigateToMock).not.toHaveBeenCalled()
  })

  it('shows a success toast and navigates to /chat on login success', async () => {
    mockSignIn({ data: { token: 'session-token' } })

    const component = await mountSuspended(LoginForm)
    await fillAndSubmit(component)
    await flushPromises()

    expect(component.text()).toContain('Welcome back!')
    expect(navigateToMock).toHaveBeenCalledWith('/chat')
  })

  it('disables the submit button while loading', async () => {
    let resolveSignIn: (value: { data: { token: string } }) => void
    const signInPromise = new Promise<{ data: { token: string } }>((resolve) => {
      resolveSignIn = resolve
    })
    useAuthClientMock.mockReturnValue({
      signIn: { email: vi.fn(() => signInPromise) },
    })

    const component = await mountSuspended(LoginForm)
    const submitButton = component.find('button[type="submit"]')
    expect(submitButton.attributes('disabled')).toBeUndefined()

    await fillAndSubmit(component)
    await flushPromises()

    expect(submitButton.attributes('disabled')).toBeDefined()

    resolveSignIn!({ data: { token: 'session-token' } })
    await flushPromises()

    expect(submitButton.attributes('disabled')).toBeUndefined()
  })
})
