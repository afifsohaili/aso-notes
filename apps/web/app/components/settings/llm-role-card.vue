<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import CheckCircleIcon from '~icons/heroicons/check-circle'
import CpuChipIcon from '~icons/heroicons/cpu-chip'
import ExclamationTriangleIcon from '~icons/heroicons/exclamation-triangle'
import XCircleIcon from '~icons/heroicons/x-circle'

export type LlmRole = 'agent' | 'extraction' | 'embedding'

export interface ProviderAvailability {
  openrouter: boolean
  ollama: boolean
}

export type TestStatus
  = | { kind: 'idle' }
    | { kind: 'ok' }
    | { kind: 'error', error: string }
    | { kind: 'dims', dims: number }

interface Props {
  role: LlmRole
  provider: string
  model: string
  baseUrl?: string | null
  available: ProviderAvailability
  testStatus?: TestStatus
  saveDisabled?: boolean
  saving?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  baseUrl: null,
  testStatus: () => ({ kind: 'idle' }),
  saveDisabled: false,
  saving: false,
})

const emit = defineEmits<{
  (e: 'update:provider', value: string): void
  (e: 'update:model', value: string): void
  (e: 'update:baseUrl', value: string | null): void
  (e: 'test', payload: { role: LlmRole, provider: string, model: string, baseUrl: string | null }): void
  (e: 'save', payload: { role: LlmRole, provider: string, model: string, baseUrl: string | null }): void
}>()

const { t } = useI18n()

const localProvider = ref(props.provider)
const localModel = ref(props.model)
const localBaseUrl = ref(props.baseUrl ?? '')

watch(() => props.provider, v => localProvider.value = v)
watch(() => props.model, v => localModel.value = v)
watch(() => props.baseUrl, v => localBaseUrl.value = v ?? '')

const providerOptions = computed(() => [
  { value: 'openrouter', label: 'OpenRouter', enabled: props.available.openrouter },
  { value: 'ollama', label: 'Ollama', enabled: props.available.ollama },
])

const isEmbedding = computed(() => props.role === 'embedding')

const isFormChanged = computed(() => {
  return localProvider.value !== props.provider
    || localModel.value !== props.model
    || (localBaseUrl.value || null) !== (props.baseUrl || null)
})

const isSaveDisabled = computed(() => {
  if (props.saving)
    return true
  if (!localModel.value.trim())
    return true
  if (props.saveDisabled)
    return true
  if (isEmbedding.value && props.testStatus?.kind === 'dims')
    return true
  return false
})

function onTest() {
  emit('test', {
    role: props.role,
    provider: localProvider.value,
    model: localModel.value.trim(),
    baseUrl: localBaseUrl.value.trim() || null,
  })
}

function onSave() {
  emit('save', {
    role: props.role,
    provider: localProvider.value,
    model: localModel.value.trim(),
    baseUrl: localBaseUrl.value.trim() || null,
  })
}

function onProviderChange(event: Event) {
  const target = event.target as HTMLSelectElement
  emit('update:provider', target.value)
}

function onModelInput(event: Event) {
  const target = event.target as HTMLInputElement
  emit('update:model', target.value)
}

function onBaseUrlInput(event: Event) {
  const target = event.target as HTMLInputElement
  emit('update:baseUrl', target.value.trim() || null)
}

const roleTitleKey = computed(() => `settings.llm.roles.${props.role}`)
const roleHelpKey = computed(() => `settings.llm.roles.${props.role}Help`)
</script>

<template>
  <div class="rounded-lg border border-gray-200 bg-white p-5">
    <div class="flex items-center gap-2">
      <CpuChipIcon class="h-5 w-5 text-indigo-600" />>
      <h3 class="text-base font-semibold text-gray-900">
        {{ t(roleTitleKey) }}
      </h3>
    </div>

    <p class="mt-1 text-sm text-gray-600">
      {{ t(roleHelpKey) }}
    </p>

    <div class="mt-4 grid gap-4">
      <div>
        <label :for="`${role}-provider`" class="block text-sm font-medium text-gray-700">
          {{ t('settings.llm.providerLabel') }}
        </label>
        <select
          :id="`${role}-provider`"
          :value="localProvider"
          class="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          @change="onProviderChange"
        >
          <option
            v-for="option in providerOptions"
            :key="option.value"
            :value="option.value"
            :disabled="!option.enabled"
          >
            {{ option.label }} {{ option.enabled ? '' : t('settings.llm.providerUnavailable') }}
          </option>
        </select>
      </div>

      <div>
        <label :for="`${role}-model`" class="block text-sm font-medium text-gray-700">
          {{ t('settings.llm.modelLabel') }}
        </label>
        <input
          :id="`${role}-model`"
          :value="localModel"
          type="text"
          class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          :placeholder="t('settings.llm.modelPlaceholder')"
          @input="onModelInput"
        >
      </div>

      <div>
        <label :for="`${role}-base-url`" class="block text-sm font-medium text-gray-700">
          {{ t('settings.llm.baseUrlLabel') }}
        </label>
        <input
          :id="`${role}-base-url`"
          :value="localBaseUrl"
          type="text"
          class="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          :placeholder="t('settings.llm.baseUrlPlaceholder')"
          @input="onBaseUrlInput"
        >
      </div>
    </div>

    <div v-if="isEmbedding" class="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
      <div class="flex items-start gap-2">
        <ExclamationTriangleIcon class="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />>
        <div>
          <p class="font-medium">
            {{ t('settings.llm.embedding.warning') }}
          </p>
          <p class="mt-0.5">
            {{ t('settings.llm.embedding.rebuildWarning') }}
          </p>
        </div>
      </div>
    </div>

    <div class="mt-4 flex flex-wrap items-center gap-3">
      <button
        type="button"
        class="inline-flex items-center rounded-md bg-white px-3 py-2 text-sm font-medium text-gray-700 border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
        :disabled="!localModel.trim()"
        @click="onTest"
      >
        {{ t('settings.llm.testConnection') }}
      </button>

      <button
        type="button"
        class="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        :disabled="isSaveDisabled"
        @click="onSave"
      >
        <span v-if="saving">{{ t('settings.llm.saving') }}</span>
        <span v-else>{{ isFormChanged ? t('settings.llm.save') : t('settings.saved') }}</span>
      </button>

      <span
        v-if="testStatus.kind === 'ok'"
        class="flex items-center gap-1 text-sm font-medium text-green-600"
        role="status"
        data-testid="llm-test-ok"
      >
        <CheckCircleIcon class="h-4 w-4" />
        {{ t('settings.llm.testOk') }}
      </span>

      <span
        v-else-if="testStatus.kind === 'error'"
        class="flex items-center gap-1 text-sm font-medium text-red-600"
        role="alert"
        data-testid="llm-test-error"
      >
        <XCircleIcon class="h-4 w-4" />
        {{ t('settings.llm.testError', { error: testStatus.error }) }}
      </span>

      <span
        v-else-if="testStatus.kind === 'dims'"
        class="flex max-w-md items-start gap-1 text-sm font-medium text-amber-600"
        role="alert"
        data-testid="llm-test-dims"
      >
        <ExclamationTriangleIcon class="mt-0.5 h-4 w-4 flex-shrink-0" />
        {{ t('settings.llm.dimsMismatch', { dims: testStatus.dims, expected: 2048 }) }}
      </span>
    </div>
  </div>
</template>
