<script setup lang="ts">
import type { Ref } from 'vue'

interface SettingEntry {
  value: string | number
  source: 'workspace' | 'default'
}

interface SettingsPayload {
  settings: Record<string, SettingEntry>
}

const VOCABULARY_STRATEGIES = ['top-k', 'blind-merge', 'full'] as const

definePageMeta({
  middleware: ['auth'],
  layout: 'default',
})

const { t } = useI18n()

const { data: payload, pending, refresh } = await useFetch<SettingsPayload>('/api/settings')

const strategy: Ref<typeof VOCABULARY_STRATEGIES[number]> = ref('top-k')
const threshold: Ref<number | ''> = ref('')
const status = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')

watch(
  () => payload.value?.settings,
  (settings) => {
    const strategyValue = settings?.['extraction.vocabulary_strategy']?.value
    if (typeof strategyValue === 'string' && (VOCABULARY_STRATEGIES as readonly string[]).includes(strategyValue)) {
      strategy.value = strategyValue as typeof VOCABULARY_STRATEGIES[number]
    }

    const thresholdValue = settings?.['extraction.blind_merge_threshold']?.value
    if (typeof thresholdValue === 'number') {
      threshold.value = thresholdValue
    }
  },
  { immediate: true },
)

const showThreshold = computed(() => strategy.value === 'blind-merge')

async function save() {
  status.value = 'saving'
  try {
    await $fetch('/api/settings', {
      method: 'PATCH',
      body: {
        key: 'extraction.vocabulary_strategy',
        value: strategy.value,
      },
    })

    if (showThreshold.value && threshold.value !== '') {
      await $fetch('/api/settings', {
        method: 'PATCH',
        body: {
          key: 'extraction.blind_merge_threshold',
          value: Number(threshold.value),
        },
      })
    }

    await refresh()
    status.value = 'saved'
  }
  catch {
    status.value = 'error'
  }
}

function onStrategyChange() {
  status.value = 'idle'
  if (strategy.value === 'blind-merge' && threshold.value === '') {
    threshold.value = 0.85
  }
}
</script>

<template>
  <div class="container max-w-2xl px-6 py-10 mx-auto">
    <h1 class="text-2xl font-bold text-gray-900">
      {{ t('settings.title') }}
    </h1>

    <div v-if="pending" class="mt-8 text-gray-500">
      {{ t('chat.streaming') }}
    </div>

    <form v-else class="mt-8 space-y-6" @submit.prevent="save">
      <div>
        <label for="vocabulary-strategy" class="block text-sm font-medium text-gray-700">
          {{ t('settings.strategyLabel') }}
        </label>
        <p class="mt-1 text-sm text-gray-500">
          {{ t('settings.strategyHelp') }}
        </p>
        <select
          id="vocabulary-strategy"
          v-model="strategy"
          class="mt-2 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          @change="onStrategyChange"
        >
          <option
            v-for="option in VOCABULARY_STRATEGIES"
            :key="option"
            :value="option"
          >
            {{ option }}
          </option>
        </select>
      </div>

      <div v-if="showThreshold">
        <label for="merge-threshold" class="block text-sm font-medium text-gray-700">
          {{ t('settings.thresholdLabel') }}
        </label>
        <p class="mt-1 text-sm text-gray-500">
          {{ t('settings.thresholdHelp') }}
        </p>
        <input
          id="merge-threshold"
          v-model.number="threshold"
          type="number"
          min="0.01"
          max="1"
          step="0.01"
          class="mt-2 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          @input="status = 'idle'"
        >
      </div>

      <div class="flex items-center gap-4">
        <button
          type="submit"
          :disabled="status === 'saving'"
          class="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {{ t('settings.save') }}
        </button>

        <span
          v-if="status === 'saved'"
          class="text-sm font-medium text-green-600"
          role="status"
        >
          {{ t('settings.saved') }}
        </span>

        <span
          v-if="status === 'error'"
          class="text-sm font-medium text-red-600"
          role="alert"
        >
          {{ t('settings.saveError') }}
        </span>
      </div>
    </form>
  </div>
</template>
