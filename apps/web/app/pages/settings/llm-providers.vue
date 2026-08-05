<script setup lang="ts">
import type { IngestionStatusResponse } from '~~/server/lib/sync/ingestion-status'
import type { LlmRole, ProviderAvailability, TestStatus } from '~/components/settings/llm-role-card.vue'
import { useI18n } from 'vue-i18n'
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
const DEFAULT_PROVIDER_AVAILABILITY: ProviderAvailability = { openrouter: true, ollama: true }

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
    const result = await $fetch('/api/settings/test-connection', {
      method: 'POST',
      body: {
        role,
        provider: llmProvider[role],
        model: (llmModel[role] as string).trim(),
        base_url: (llmBaseUrl[role] as string).trim() || undefined,
      },
    }) as { ok: boolean, dims?: number, expected?: number, error?: string }

    if (result.ok) {
      llmTestStatus[role] = { kind: 'ok' }
    }
    else if (typeof result.dims === 'number') {
      llmTestStatus[role] = { kind: 'dims', dims: result.dims }
    }
    else {
      llmTestStatus[role] = { kind: 'error', error: result.error ?? 'unknown error' }
    }
  }
  catch (err) {
    llmTestStatus[role] = { kind: 'error', error: err instanceof Error ? err.message : 'unknown error' }
  }
}

async function saveRole(role: LlmRole) {
  if (role === 'embedding') {
    await testConnection(role)
    const status = llmTestStatus[role]
    if (status.kind !== 'ok')
      return
  }

  llmSaving[role] = true
  try {
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
  catch (err) {
    llmTestStatus[role] = { kind: 'error', error: err instanceof Error ? err.message : 'unknown error' }
  }
  finally {
    llmSaving[role] = false
  }
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
  </div>
</template>
