<script setup lang="ts">
import type { IngestionStatusResponse } from '~~/server/lib/sync/ingestion-status'
import type { LlmRole, ProviderAvailability, TestStatus } from '~/components/settings/llm-role-card.vue'
import { useI18n } from 'vue-i18n'
import ExclamationTriangleIcon from '~icons/heroicons/exclamation-triangle'
import LlmRoleCard from '~/components/settings/llm-role-card.vue'
import WizardStepVerify from '~/components/settings/wizard-step-verify.vue'

interface SettingEntry {
  value: string | number | null
  source: 'workspace' | 'default'
}

interface SettingsPayload {
  settings: Record<string, SettingEntry>
}

interface SyncedFolderApiItem {
  id: string
  path: string
  basename: string
  noteCount: number
  alias: string | null
}

interface ProviderAvailabilityPayload {
  providers: Record<LlmRole, ProviderAvailability>
}

const LLM_ROLES: LlmRole[] = ['agent', 'extraction', 'embedding']
const DEFAULT_PROVIDER_AVAILABILITY: ProviderAvailability = { openrouter: true, ollama: true, omlx: true }

const { t } = useI18n()

const { data: payload } = await useFetch<SettingsPayload>('/api/settings')
const { data: folders } = await useFetch<SyncedFolderApiItem[]>('/api/synced-folders')
const { data: availabilityPayload } = await useFetch<ProviderAvailabilityPayload>('/api/settings/providers')
const { data: ingestionStatus } = await useFetch<IngestionStatusResponse>('/api/ingestion/status')

const llmProvider = reactive({
  agent: 'openrouter',
  extraction: 'openrouter',
  embedding: 'openrouter',
})

const llmModel = reactive({
  agent: '',
  extraction: '',
  embedding: '',
})

const llmBaseUrl = reactive({
  agent: '',
  extraction: '',
  embedding: '',
})

watch(
  () => payload.value?.settings,
  (settings) => {
    for (const role of LLM_ROLES) {
      const providerSetting = settings?.[`llm.${role}.provider`]?.value
      if (typeof providerSetting === 'string')
        llmProvider[role] = providerSetting
      const modelSetting = settings?.[`llm.${role}.model`]?.value
      if (typeof modelSetting === 'string')
        llmModel[role] = modelSetting
      const baseUrlSetting = settings?.[`llm.${role}.base_url`]?.value
      llmBaseUrl[role] = typeof baseUrlSetting === 'string' ? baseUrlSetting : ''
    }
  },
  { immediate: true },
)

const llmConfigured = computed(() => LLM_ROLES.every(role => (llmModel[role] as string).trim().length > 0))
const hasFolder = computed(() => (folders.value ?? []).length > 0)
const hasRedis = computed(() => ingestionStatus.value?.queue !== null)

const llmTestStatus = reactive<Record<LlmRole, TestStatus>>({
  agent: { kind: 'idle' },
  extraction: { kind: 'idle' },
  embedding: { kind: 'idle' },
})

const llmSaving = reactive({
  agent: false,
  extraction: false,
  embedding: false,
})

// Embeddings from different models are never comparable. When the user
// changes the embedding model we must warn, then wipe + re-ingest, so we
// compare the newly typed model against the last *saved* value.
const savedEmbeddingModel = computed(() => {
  const value = payload.value?.settings?.['llm.embedding.model']?.value
  return typeof value === 'string' ? value : ''
})

const showModelSwitchDialog = ref(false)
const modelSwitchSaveError = ref('')
const modelSwitchRebuildError = ref('')
const modelSwitchWorking = ref(false)

function openModelSwitchDialog() {
  modelSwitchSaveError.value = ''
  modelSwitchRebuildError.value = ''
  modelSwitchWorking.value = false
  showModelSwitchDialog.value = true
}

function closeModelSwitchDialog() {
  showModelSwitchDialog.value = false
}

const roleAvailability = computed(() => {
  const providers = availabilityPayload.value?.providers
  return {
    agent: providers?.agent ?? DEFAULT_PROVIDER_AVAILABILITY,
    extraction: providers?.extraction ?? DEFAULT_PROVIDER_AVAILABILITY,
    embedding: providers?.embedding ?? DEFAULT_PROVIDER_AVAILABILITY,
  }
})

async function testConnection(role: LlmRole) {
  llmTestStatus[role] = { kind: 'idle' }
  try {
    // NOTE: URL cast to plain string — Nuxt route-rules types blow up instantiation depth under TS 6 (TS2321)
    const result = await $fetch<{ ok: boolean, error?: string }>('/api/settings/test-connection' as string, {
      method: 'POST',
      body: {
        role,
        provider: llmProvider[role],
        model: (llmModel[role] as string).trim(),
        base_url: (llmBaseUrl[role] as string).trim() || undefined,
      },
    })

    if (result.ok) {
      llmTestStatus[role] = { kind: 'ok' }
    }
    else {
      llmTestStatus[role] = { kind: 'error', error: result.error ?? 'unknown error' }
    }
  }
  catch (err) {
    llmTestStatus[role] = { kind: 'error', error: err instanceof Error ? err.message : 'unknown error' }
  }
}

async function persistRoleFields(role: LlmRole) {
  const fields = [
    { key: `llm.${role}.provider`, value: llmProvider[role] as string },
    { key: `llm.${role}.model`, value: (llmModel[role] as string).trim() },
    { key: `llm.${role}.base_url`, value: (llmBaseUrl[role] as string).trim() || null },
  ]

  for (const field of fields) {
    await $fetch('/api/settings', {
      method: 'PATCH',
      body: { key: field.key, value: field.value },
    })
  }
}

/**
 * Intercept a save for a changed embedding model: embeddings from different
 * models are never comparable, so switching silently breaks retrieval. Before
 * anything is saved, show a warning dialog; only on confirm do we save the new
 * model and trigger the rebuild (notes → pending, re-ingested with the new
 * model). Cancel leaves the saved model and data untouched.
 */
async function saveRole(role: LlmRole) {
  if (role === 'embedding') {
    await testConnection(role)
    const status = llmTestStatus[role]
    if (status.kind !== 'ok')
      return

    const current = (llmModel.embedding as string).trim()
    if (didEmbeddingModelChange(savedEmbeddingModel.value, current)) {
      openModelSwitchDialog()
      return
    }
  }

  await saveRoleFields(role)
}

async function saveRoleFields(role: LlmRole) {
  llmSaving[role] = true
  try {
    await persistRoleFields(role)
  }
  catch (err) {
    llmTestStatus[role] = { kind: 'error', error: err instanceof Error ? err.message : 'unknown error' }
  }
  finally {
    llmSaving[role] = false
  }
}

/**
 * User confirmed the warning: save the new embedding model first, then trigger
 * the rebuild flow. Surfacing failures from either step, we keep the dialog
 * open so the user can retry.
 */
async function onModelSwitchConfirm() {
  modelSwitchWorking.value = true
  modelSwitchSaveError.value = ''
  modelSwitchRebuildError.value = ''
  try {
    await persistRoleFields('embedding')
  }
  catch (err) {
    modelSwitchSaveError.value = err instanceof Error ? err.message : t('settings.saveError')
    modelSwitchWorking.value = false
    return
  }

  try {
    await $fetch('/api/settings/rebuild', { method: 'POST' })
  }
  catch {
    modelSwitchRebuildError.value = t('settings.saveError')
    modelSwitchWorking.value = false
    return
  }

  showModelSwitchDialog.value = false
}

const showReverify = ref(false)

function openReverify() {
  showReverify.value = true
}

function closeReverify() {
  showReverify.value = false
}

definePageMeta({
  layout: 'settings',
})
</script>

<template>
  <div class="space-y-6">
    <section>
      <h2 class="text-lg font-semibold text-gray-900">
        {{ t('settings.llm.title') }}
      </h2>
      <p class="mt-1 text-sm text-gray-600">
        {{ t('settings.llm.help') }}
      </p>

      <div class="mt-4 grid gap-4">
        <LlmRoleCard
          v-for="role in LLM_ROLES"
          :key="role"
          :role="role"
          :provider="llmProvider[role]"
          :model="llmModel[role]"
          :base-url="llmBaseUrl[role]"
          :available="roleAvailability[role]"
          :test-status="llmTestStatus[role]"
          :save-disabled="!llmModel[role].trim()"
          :saving="llmSaving[role]"
          @update:provider="(v: string) => llmProvider[role] = v"
          @update:model="(v: string) => llmModel[role] = v"
          @update:base-url="(v: string | null) => llmBaseUrl[role] = v ?? ''"
          @test="testConnection(role)"
          @save="saveRole(role)"
        />
      </div>
    </section>

    <section>
      <h2 class="text-lg font-semibold text-gray-900">
        {{ t('settings.wizard.reverify.title') }}
      </h2>
      <p class="mt-1 text-sm text-gray-600">
        {{ t('settings.wizard.reverify.help') }}
      </p>

      <div class="mt-4">
        <button
          type="button"
          class="inline-flex items-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          data-testid="reverify-open-button"
          @click="openReverify"
        >
          {{ t('settings.wizard.reverify.button') }}
        </button>
      </div>

      <div v-if="showReverify" class="mt-4 rounded-lg border border-gray-200 bg-white p-5">
        <WizardStepVerify
          :has-folder="hasFolder"
          :has-redis="hasRedis"
          :llm-configured="llmConfigured"
          is-reverify
          @complete="closeReverify"
        />
      </div>
    </section>

    <!-- Embedding model change warning dialog -->
    <div
      v-if="showModelSwitchDialog"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      data-testid="embedding-model-switch-dialog"
      @click.self="closeModelSwitchDialog"
    >
      <div class="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <div class="flex items-center gap-2">
          <ExclamationTriangleIcon class="h-5 w-5 text-amber-600" />
          <h3 class="text-lg font-semibold text-gray-900">
            {{ t('settings.llm.modelSwitch.title') }}
          </h3>
        </div>

        <p class="mt-2 text-sm text-gray-600">
          {{ t('settings.llm.modelSwitch.description') }}
        </p>

        <div class="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          <p class="font-medium">
            {{ t('settings.llm.modelSwitch.warning') }}
          </p>
        </div>

        <p v-if="modelSwitchSaveError" class="mt-3 text-sm font-medium text-red-600" role="alert">
          {{ modelSwitchSaveError }}
        </p>
        <p v-if="modelSwitchRebuildError" class="mt-3 text-sm font-medium text-red-600" role="alert">
          {{ modelSwitchRebuildError }}
        </p>

        <div class="mt-4 flex items-center justify-end gap-3">
          <button
            type="button"
            class="rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
            :disabled="modelSwitchWorking"
            data-testid="embedding-model-switch-cancel"
            @click="closeModelSwitchDialog"
          >
            {{ t('settings.rebuild.cancel') }}
          </button>

          <button
            type="button"
            class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            :disabled="modelSwitchWorking"
            data-testid="embedding-model-switch-confirm"
            @click="onModelSwitchConfirm"
          >
            {{ t('settings.llm.modelSwitch.confirm') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
