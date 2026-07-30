<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import ArrowPathIcon from '~icons/heroicons/arrow-path'
import BeakerIcon from '~icons/heroicons/beaker'
import CheckCircleIcon from '~icons/heroicons/check-circle'
import ExclamationTriangleIcon from '~icons/heroicons/exclamation-triangle'

const props = defineProps<{
  hasFolder: boolean
  hasRedis: boolean
  llmConfigured: boolean
  isReverify?: boolean
}>()

const emit = defineEmits<{
  (e: 'complete'): void
}>()

const { t } = useI18n()

type Phase = 'written' | 'pending' | 'queued' | 'processing' | 'ingested' | 'deleting' | 'done' | 'failed' | 'idle'

const isRunning = ref(false)
const attemptId = ref<string | null>(null)
const phase = ref<Phase>('idle')
const error = ref('')
const lastRun = ref<unknown>(null)

let pollInterval: ReturnType<typeof setInterval> | null = null

const ready = computed(() => props.hasFolder && props.hasRedis && props.llmConfigured)

const phaseLabel = computed(() => {
  if (phase.value === 'idle' && isRunning.value)
    return t('settings.wizard.steps.verify.running')
  if (phase.value === 'idle')
    return ''
  if (phase.value === 'failed')
    return t('settings.wizard.steps.verify.phase.failed')
  if (phase.value === 'done')
    return t('settings.wizard.steps.verify.phase.done')
  return t(`settings.wizard.steps.verify.phase.${phase.value}`)
})

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval)
    pollInterval = null
  }
}

onUnmounted(stopPolling)

async function poll() {
  if (!attemptId.value)
    return

  try {
    const state = await $fetch('/api/onboarding/smoke-test', {
      query: { attemptId: attemptId.value },
    }) as { phase: Phase, error?: string, lastRun?: unknown }

    phase.value = state.phase
    error.value = state.error ?? ''
    lastRun.value = state.lastRun ?? null

    if (state.phase === 'done') {
      stopPolling()
      isRunning.value = false
      emit('complete')
    }

    if (state.phase === 'failed') {
      stopPolling()
      isRunning.value = false
    }
  }
  catch (err) {
    stopPolling()
    isRunning.value = false
    error.value = err instanceof Error ? err.message : t('settings.wizard.steps.verify.error.unknown')
  }
}

async function start() {
  if (!ready.value || isRunning.value)
    return

  stopPolling()
  isRunning.value = true
  phase.value = 'idle'
  error.value = ''
  lastRun.value = null

  try {
    const result = await $fetch('/api/onboarding/smoke-test', { method: 'POST' }) as { attemptId: string, phase: Phase }
    attemptId.value = result.attemptId
    phase.value = result.phase

    pollInterval = setInterval(poll, 1500)
  }
  catch (err) {
    isRunning.value = false
    if (err instanceof Error && 'statusCode' in err) {
      const status = (err as any).statusCode
      if (status === 409) {
        const code = (err as any).data?.code
        if (code === 'redis_required')
          error.value = t('settings.wizard.steps.verify.error.noRedis')
        else if (code === 'no_synced_folder')
          error.value = t('settings.wizard.steps.verify.error.noFolder')
        else
          error.value = err.message
      }
      else {
        error.value = err.message
      }
    }
    else {
      error.value = err instanceof Error ? err.message : t('settings.wizard.steps.verify.error.unknown')
    }
  }
}
</script>

<template>
  <div class="rounded-lg border border-gray-200 bg-white p-5">
    <div class="flex items-center gap-2">
      <BeakerIcon class="h-5 w-5 text-indigo-600" />
      <h3 class="text-base font-semibold text-gray-900">
        {{ isReverify ? t('settings.wizard.reverify.title') : t('settings.wizard.steps.verify.title') }}
      </h3>
      <span
        v-if="phase === 'done'"
        class="ml-auto inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700"
      >
        <CheckCircleIcon class="h-3 w-3" />
        {{ t('settings.wizard.steps.verify.complete') }}
      </span>
    </div>

    <p class="mt-2 text-sm text-gray-600">
      {{ isReverify ? t('settings.wizard.reverify.help') : t('settings.wizard.steps.verify.help') }}
    </p>

    <div class="mt-4">
      <div v-if="!ready" class="rounded-md bg-yellow-50 p-3 text-sm text-yellow-800">
        <div class="flex items-start gap-2">
          <ExclamationTriangleIcon class="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div>
            <p v-if="!hasFolder">
              {{ t('settings.wizard.steps.verify.error.noFolder') }}
            </p>
            <p v-else-if="!hasRedis">
              {{ t('settings.wizard.steps.verify.error.noRedis') }}
            </p>
            <p v-else>
              {{ t('settings.wizard.steps.verify.error.unknown') }}
            </p>
          </div>
        </div>
      </div>

      <div v-else-if="phase === 'idle' || phase === 'failed' || phase === 'done'" class="flex flex-wrap items-center gap-3">
        <button
          type="button"
          class="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          :disabled="isRunning"
          data-testid="run-smoke-test"
          @click="start"
        >
          <ArrowPathIcon v-if="phase === 'failed' || phase === 'done'" class="h-4 w-4" />
          <BeakerIcon v-else class="h-4 w-4" />
          {{ phase === 'failed' || phase === 'done' ? t('settings.wizard.steps.verify.retry') : t('settings.wizard.steps.verify.runButton') }}
        </button>
      </div>

      <div v-else class="flex items-center gap-3">
        <div class="h-5 w-5 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
        <span class="text-sm text-gray-700">{{ phaseLabel }}</span>
      </div>

      <div
        v-if="error"
        class="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        role="alert"
      >
        <div class="flex items-start gap-2">
          <ExclamationTriangleIcon class="mt-0.5 h-4 w-4 flex-shrink-0" />
          <div>
            <p class="font-medium">
              {{ error }}
            </p>
            <details v-if="lastRun" class="mt-2">
              <summary class="cursor-pointer text-xs text-red-700">
                Details
              </summary>
              <pre class="mt-1 max-h-32 overflow-auto rounded bg-red-100 p-2 text-xs">{{ JSON.stringify(lastRun, null, 2) }}</pre>
            </details>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
