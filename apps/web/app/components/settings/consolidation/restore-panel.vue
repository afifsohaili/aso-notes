<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import ArrowUturnLeftIcon from '~icons/heroicons/arrow-uturn-left'
import CheckCircleIcon from '~icons/heroicons/check-circle'
import ExclamationTriangleIcon from '~icons/heroicons/exclamation-triangle'

const props = defineProps<{
  runId: string
}>()

const emit = defineEmits<{
  (e: 'restored'): void
}>()

const { t } = useI18n()

const RESTORE_CONFIRM_TEXT = 'RESTORE'

const confirming = ref(false)
const confirmText = ref('')
const loading = ref(false)
const error = ref<string | null>(null)
const success = ref(false)

const isConfirmed = computed(() => confirmText.value.trim() === RESTORE_CONFIRM_TEXT)

function openConfirm() {
  confirming.value = true
  confirmText.value = ''
  error.value = null
  success.value = false
}

function cancel() {
  confirming.value = false
  confirmText.value = ''
  error.value = null
}

async function confirmRestore() {
  if (!isConfirmed.value || loading.value)
    return

  loading.value = true
  error.value = null

  try {
    await $fetch(`/api/consolidation/runs/${props.runId}/restore`, { method: 'POST' })
    success.value = true
    confirming.value = false
    emit('restored')
  }
  catch (err: unknown) {
    const statusCode = err instanceof Error && 'statusCode' in err ? (err as { statusCode: number }).statusCode : undefined
    if (statusCode === 404) {
      error.value = t('settings.consolidation.errors.noSnapshot')
    }
    else {
      error.value = t('settings.consolidation.errors.restoreFailed')
    }
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="rounded-lg border-2 border-red-200 bg-red-50 p-5" data-testid="restore-panel">
    <div class="flex items-start gap-3">
      <ArrowUturnLeftIcon class="h-5 w-5 flex-shrink-0 text-red-700" />
      <div class="flex-1">
        <h3 class="text-sm font-semibold text-red-900">
          {{ t('settings.consolidation.restore.title') }}
        </h3>
        <p class="mt-1 text-xs text-red-700">
          {{ t('settings.consolidation.restore.warning') }}
        </p>
        <button
          type="button"
          class="mt-3 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          data-testid="restore-open-button"
          @click="openConfirm"
        >
          {{ t('settings.consolidation.restore.button') }}
        </button>
      </div>
    </div>

    <div
      v-if="success"
      class="mt-3 flex items-center gap-2 rounded-md bg-green-100 px-3 py-2 text-sm text-green-800"
      role="status"
    >
      <CheckCircleIcon class="h-4 w-4" />
      {{ t('settings.consolidation.restore.success') }}
    </div>

    <!-- Confirm dialog -->
    <div
      v-if="confirming"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      @click.self="cancel"
    >
      <div class="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <div class="flex items-start gap-3">
          <ExclamationTriangleIcon class="h-5 w-5 flex-shrink-0 text-red-600" />
          <div>
            <h3 class="text-lg font-semibold text-gray-900">
              {{ t('settings.consolidation.restore.dialogTitle') }}
            </h3>
            <p class="mt-2 text-sm text-gray-600">
              {{ t('settings.consolidation.restore.dialogHelp') }}
            </p>
          </div>
        </div>

        <input
          v-model="confirmText"
          type="text"
          class="mt-4 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
          :placeholder="t('settings.consolidation.restore.placeholder')"
          data-testid="restore-confirm-input"
        >

        <div class="mt-4 flex items-center justify-end gap-3">
          <button
            type="button"
            class="rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
            data-testid="restore-cancel-button"
            @click="cancel"
          >
            {{ t('settings.consolidation.restore.cancel') }}
          </button>
          <button
            type="button"
            class="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            :disabled="!isConfirmed || loading"
            data-testid="restore-confirm-button"
            @click="confirmRestore"
          >
            {{ loading ? t('settings.consolidation.restore.restoring') : t('settings.consolidation.restore.confirm') }}
          </button>
        </div>

        <p
          v-if="error"
          class="mt-3 text-sm text-red-600"
          role="alert"
        >
          {{ error }}
        </p>
      </div>
    </div>
  </div>
</template>
