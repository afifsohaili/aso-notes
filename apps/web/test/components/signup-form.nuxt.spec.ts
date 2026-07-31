import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SignupForm from '../../app/components/auth/signup-form.vue'

const { useAuthClientMock, navigateToMock } = vi.hoisted(() => ({
  useAuthClientMock: vi.fn(),
  navigateToMock: vi.fn(),
}))

mockNuxtImport('useAuthClient', () => useAuthClientMock)
mockNuxtImport('navigateTo', () => navigateToMock)

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development')
  useAuthClientMock.mockClear()
  navigateToMock.mockClear()
})

function mockSignUp(response: { error?: { message: string } | null, data?: unknown }) {
  useAuthClientMock.mockReturnValue({
    signUp: { email: vi.fn().mockResolvedValue(response) },
  })
}

async function fillAndSubmit(component: Awaited<ReturnType<typeof mountSuspended>>) {
  await component.find('input#email').setValue('new@example.com')
  await component.find('input#password').setValue('password123')
  await component.find('input#confirmPassword').setValue('password123')
  await component.find('form').trigger('submit')
}

describe('signup-form', () => {
  it('shows an error toast when passwords do not match', async () => {
    mockSignUp({ data: {} })

    const component = await mountSuspended(SignupForm)
    await component.find('input#email').setValue('new@example.com')
    await component.find('input#password').setValue('password123')
    await component.find('input#confirmPassword').setValue('different')
    await component.find('form').trigger('submit')
    await flushPromises()

    expect(component.text()).toContain('Passwords do not match')
    expect(useAuthClientMock).not.toHaveBeenCalled()
    expect(navigateToMock).not.toHaveBeenCalled()
  })

  it('shows a success toast and navigates to /chat when signup creates a session', async () => {
    mockSignUp({ data: { token: 'session-token' } })

    const component = await mountSuspended(SignupForm)
    await fillAndSubmit(component)
    await flushPromises()

    expect(component.text()).toContain('Account created — taking you in')
    expect(navigateToMock).toHaveBeenCalledWith('/chat')
  })

  it('shows a verify-email state and does not navigate when no session is created', async () => {
    mockSignUp({ data: { user: { id: 'user-1' } } })

    const component = await mountSuspended(SignupForm)
    await fillAndSubmit(component)
    await flushPromises()

    expect(component.text()).toContain('Account created — check your email to verify')
    expect(component.text()).toContain('Check your email and click the verification link')
    expect(navigateToMock).not.toHaveBeenCalled()
  })

  it('disables the submit button while loading', async () => {
    let resolveSignUp: (value: { data: { token: string } }) => void
    const signUpPromise = new Promise<{ data: { token: string } }>((resolve) => {
      resolveSignUp = resolve
    })
    useAuthClientMock.mockReturnValue({
      signUp: { email: vi.fn(() => signUpPromise) },
    })

    const component = await mountSuspended(SignupForm)
    const submitButton = component.find('button[type="submit"]')
    expect(submitButton.attributes('disabled')).toBeUndefined()

    await fillAndSubmit(component)
    await flushPromises()

    expect(submitButton.attributes('disabled')).toBeDefined()

    resolveSignUp!({ data: { token: 'session-token' } })
    await flushPromises()

    expect(submitButton.attributes('disabled')).toBeUndefined()
  })
})
