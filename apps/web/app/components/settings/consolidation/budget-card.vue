<script setup lang="ts">
import { useI18n } from 'vue-i18n'

interface SettingEntry {
  value: string | number | null
  source: 'workspace' | 'default'
}

interface SettingsPayload {
  settings: Record<string, SettingEntry>
}

const { t } = useI18n()

const { data: payload, refresh: refreshSettings } = await useFetch<SettingsPayload>('/api/settings')

const budget = ref<number | ''>('')
const status = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')

watch(
  () => payload.value?.settings,
  (settings) => {
    const value = settings?.['consolidation.run_budget']?.value
    if (typeof value === 'number')
      budget.value = value
  },
  { immediate: true },
)

function onInput() {
  status.value = 'idle'
}

async function saveBudget() {
  if (budget.value === '')
    return

  status.value = 'saving'
  try {
    await $fetch('/api/settings', {
      method: 'PATCH',
      body: {
        key: 'consolidation.run_budget',
        value: Number(budget.value),
      },
    })

    await refreshSettings()
    status.value = 'saved'
  }
  catch (error) {
    status.value = 'error'
    if (error instanceof Error)
      console.error('failed to save consolidation budget', error.message)
  }
}
</script>

<template>
  <form class="rounded-lg border border-gray-200 bg-white p-5" @submit.prevent="saveBudget">
    <h3 class="text-sm font-semibold text-gray-900">
      {{ t('settings.consolidation.budget.title') }}
    </h3>
    <p class="mt-1 text-sm text-gray-600">
      {{ t('settings.consolidation.budget.help') }}
    </p>

    <div class="mt-4 flex items-center gap-3">
      <input
        id="consolidation-budget"
        v-model.number="budget"
        type="number"
        min="1"
        step="1"
        class="block w-32 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        @input="onInput"
      >
      <button
        type="submit"
        :disabled="status === 'saving' || budget === ''"
        class="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        data-testid="budget-save-button"
      >
        {{ t('settings.save') }}
      </button>
    </div>

    <p
      v-if="status === 'saved'"
      class="mt-2 text-sm font-medium text-green-600"
      role="status"
      data-testid="budget-saved-message"
    >
      {{ t('settings.saved') }}
    </p>

    <p
      v-if="status === 'error'"
      class="mt-2 text-sm font-medium text-red-600"
      role="alert"
      data-testid="budget-error-message"
    >
      {{ t('settings.saveError') }}
    </p>
  </form>
</template>
