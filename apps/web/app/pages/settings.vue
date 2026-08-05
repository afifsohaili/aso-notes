<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import SettingsWizard from '~/components/settings/settings-wizard.vue'

interface SettingEntry {
  value: string | number | null
  source: 'workspace' | 'default'
}

interface SettingsPayload {
  settings: Record<string, SettingEntry>
}

const { t } = useI18n()
const { refresh: refreshOnboarding } = useOnboardingStatus()

const { data: payload, pending, refresh: refreshSettings } = await useFetch<SettingsPayload>('/api/settings')

const isWizardMode = computed(() => {
  const completed = payload.value?.settings?.['onboarding.completed_at']?.value
  return !completed || typeof completed !== 'string'
})

watch(isWizardMode, async (wizard) => {
  if (!wizard)
    await navigateTo('/settings/folders', { replace: true })
}, { immediate: true })

async function onWizardComplete() {
  await refreshSettings()
  await refreshOnboarding()
  await navigateTo('/settings/folders', { replace: true })
}
</script>

<template>
  <div>
    <div v-if="pending" class="container mx-auto px-6 py-10 text-gray-500">
      {{ t('chat.streaming') }}
    </div>
    <SettingsWizard v-else-if="isWizardMode" :settings="payload" :pending="pending" @complete="onWizardComplete" />
  </div>
</template>
