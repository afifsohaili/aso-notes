<script setup lang="ts">
import type { Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import ExclamationTriangleIcon from '~icons/heroicons/exclamation-triangle'

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
const { data: statusCounts, refresh: refreshStatusCounts } = await useFetch('/api/notes/status-counts')

const strategy: Ref<typeof VOCABULARY_STRATEGIES[number]> = ref('top-k')
const threshold: Ref<number | ''> = ref('')
const status = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')

const showRebuildDialog = ref(false)
const rebuildConfirmText = ref('')
const rebuildStatus = ref<'idle' | 'loading' | 'success' | 'error'>('idle')
const rebuildError = ref('')

const isRebuildConfirmed = computed(() => isRebuildConfirmation(rebuildConfirmText.value))

let statusPollInterval: ReturnType<typeof setInterval> | null = null

function startStatusPolling() {
  if (statusPollInterval)
    return
  statusPollInterval = setInterval(refreshStatusCounts, 3000)
}

function stopStatusPolling() {
  if (statusPollInterval) {
    clearInterval(statusPollInterval)
    statusPollInterval = null
  }
}

watch(
  () => statusCounts.value,
  (counts) => {
    if (counts && typeof counts.pending === 'number' && counts.pending > 0)
      startStatusPolling()
    else
      stopStatusPolling()
  },
  { immediate: true },
)

onUnmounted(stopStatusPolling)

async function openRebuildDialog() {
  rebuildConfirmText.value = ''
  rebuildStatus.value = 'idle'
  rebuildError.value = ''
  showRebuildDialog.value = true
}

function closeRebuildDialog() {
  showRebuildDialog.value = false
}

async function rebuild() {
  if (!isRebuildConfirmed.value)
    return
  rebuildStatus.value = 'loading'
  try {
    await $fetch('/api/settings/rebuild', { method: 'POST' })
    rebuildStatus.value = 'success'
    await refreshStatusCounts()
  }
  catch {
    rebuildStatus.value = 'error'
    rebuildError.value = t('settings.saveError')
  }
}

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

    <div class="mt-12 rounded-lg border-2 border-red-200 bg-red-50 p-6">
      <div class="flex items-center gap-2">
        <ExclamationTriangleIcon class="h-5 w-5 text-red-600" />
        <h2 class="text-lg font-semibold text-red-900">
          {{ t('settings.rebuild.title') }}
        </h2>
      </div>

      <p class="mt-2 text-sm text-red-800">
        {{ t('settings.rebuild.description') }}
      </p>

      <p class="mt-2 text-sm font-medium text-red-900">
        {{ t('settings.rebuild.strategy', { strategy }) }}
      </p>

      <p v-if="statusCounts" class="mt-1 text-sm text-red-700">
        {{ t('settings.rebuild.status', { pending: statusCounts.pending, ingested: statusCounts.ingested, failed: statusCounts.failed }) }}
      </p>

      <button
        type="button"
        class="mt-4 inline-flex items-center rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        data-testid="rebuild-open-button"
        @click="openRebuildDialog"
      >
        {{ t('settings.rebuild.button') }}
      </button>
    </div>

    <div
      v-if="showRebuildDialog"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      @click.self="closeRebuildDialog"
    >
      <div class="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h3 class="text-lg font-semibold text-gray-900">
          {{ t('settings.rebuild.dialogTitle') }}
        </h3>

        <p class="mt-2 text-sm text-gray-600">
          {{ t('settings.rebuild.dialogHelp') }}
        </p>

        <input
          v-model="rebuildConfirmText"
          type="text"
          class="mt-4 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
          :placeholder="t('settings.rebuild.confirmPlaceholder')"
          data-testid="rebuild-confirm-input"
        >

        <div class="mt-4 flex items-center justify-end gap-3">
          <button
            type="button"
            class="rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
            @click="closeRebuildDialog"
          >
            {{ t('settings.rebuild.cancel') }}
          </button>

          <button
            type="button"
            class="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            :disabled="!isRebuildConfirmed || rebuildStatus === 'loading'"
            data-testid="rebuild-confirm-button"
            @click="rebuild"
          >
            {{ t('settings.rebuild.confirm') }}
          </button>
        </div>

        <p
          v-if="rebuildStatus === 'success'"
          class="mt-3 text-sm font-medium text-green-600"
          role="status"
        >
          {{ t('settings.rebuild.success') }}
        </p>

        <p
          v-if="rebuildStatus === 'error'"
          class="mt-3 text-sm font-medium text-red-600"
          role="alert"
        >
          {{ rebuildError }}
        </p>
      </div>
    </div>
  </div>
</template>
