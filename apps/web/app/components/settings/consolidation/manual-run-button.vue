<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import ExclamationCircleIcon from '~icons/heroicons/exclamation-circle'
import PlayIcon from '~icons/heroicons/play'

const emit = defineEmits<{
  (e: 'runCreated'): void
}>()

const { t } = useI18n()

const loading = ref(false)
const error = ref<string | null>(null)

async function runNow() {
  if (loading.value)
    return

  loading.value = true
  error.value = null

  try {
    await $fetch('/api/consolidation/run', { method: 'POST' })
    emit('runCreated')
  }
  catch (err: unknown) {
    const statusCode = err instanceof Error && 'statusCode' in err ? (err as { statusCode: number }).statusCode : undefined
    if (statusCode === 409) {
      error.value = t('settings.consolidation.errors.alreadyRunning')
    }
    else if (statusCode === 503) {
      error.value = t('settings.consolidation.errors.queueUnavailable')
    }
    else {
      error.value = t('settings.consolidation.errors.startFailed')
    }
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div>
    <button
      type="button"
      class="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      data-testid="manual-run-button"
      :disabled="loading"
      @click="runNow"
    >
      <PlayIcon class="h-4 w-4" />
      <span v-if="loading">{{ t('settings.consolidation.running') }}</span>
      <span v-else>{{ t('settings.consolidation.runNow') }}</span>
    </button>

    <p
      v-if="error"
      class="mt-2 flex items-center gap-1.5 text-sm text-red-600"
      role="alert"
      data-testid="manual-run-error"
    >
      <ExclamationCircleIcon class="h-4 w-4 flex-shrink-0" />
      {{ error }}
    </p>
  </div>
</template>
