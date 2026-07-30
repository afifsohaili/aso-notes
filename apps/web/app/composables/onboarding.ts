export interface OnboardingStatus {
  completed: boolean | null
  refresh: () => Promise<boolean | null>
}

export function useOnboardingStatus(): OnboardingStatus {
  const completed = useState<boolean | null>('onboarding-completed', () => null)

  async function refresh() {
    try {
      const settings = await $fetch<{ settings: Record<string, { value: unknown }> }>('/api/settings')
      const value = settings?.settings?.['onboarding.completed_at']?.value
      completed.value = !!value && typeof value === 'string'
      return completed.value
    }
    catch {
      completed.value = null
      return null
    }
  }

  return {
    completed: computed(() => completed.value),
    refresh,
  }
}
