<script setup lang="ts">
import type { IngestionStatusResponse } from '~~/server/lib/sync/ingestion-status'
import type { LlmRole, ProviderAvailability, TestStatus } from '~/components/settings/llm-role-card.vue'
import type { SyncedFolder } from '~/components/settings/synced-folder-manager.vue'
import { useI18n } from 'vue-i18n'
import CheckCircleIcon from '~icons/heroicons/check-circle'
import ExclamationTriangleIcon from '~icons/heroicons/exclamation-triangle'
import FolderIcon from '~icons/heroicons/folder'
import RocketLaunchIcon from '~icons/heroicons/rocket-launch'
import SparklesIcon from '~icons/heroicons/sparkles'
import LlmRoleCard from '~/components/settings/llm-role-card.vue'
import SyncedFolderManager from '~/components/settings/synced-folder-manager.vue'
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

const props = defineProps<{
  settings: SettingsPayload | null
  pending: boolean
}>()

const emit = defineEmits<{
  complete: []
}>()

const LLM_ROLES: LlmRole[] = ['agent', 'extraction', 'embedding']

const DEFAULT_PROVIDER_AVAILABILITY: ProviderAvailability = { openrouter: true, ollama: true }

const { t } = useI18n()

const { data: folders, pending: foldersPending, refresh: refreshFolders } = await useFetch<SyncedFolderApiItem[]>('/api/synced-folders')
const { data: availabilityPayload } = await useFetch<ProviderAvailabilityPayload>('/api/settings/providers')
const { data: ingestionStatus } = await useFetch<IngestionStatusResponse>('/api/ingestion/status')

const verifyComplete = ref(false)

const hasFolder = computed(() => (folders.value ?? []).length > 0)
const hasRedis = computed(() => ingestionStatus.value?.queue !== null)

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
  () => props.settings?.settings,
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

const wizardSteps = computed(() => [
  { id: 'folder', label: t('settings.wizard.steps.folder.title'), complete: hasFolder.value },
  { id: 'llm', label: t('settings.wizard.steps.llm.title'), complete: llmConfigured.value },
  { id: 'verify', label: t('settings.wizard.steps.verify.title'), complete: verifyComplete.value },
])

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

const folderAddError = ref('')
const folderAdding = ref(false)
const folderDeleteErrorId = ref('')
const folderDeleteError = ref('')
const folderAliasErrorId = ref('')
const folderAliasError = ref('')

async function addFolder(path: string) {
  folderAddError.value = ''
  folderDeleteErrorId.value = ''
  folderDeleteError.value = ''
  folderAdding.value = true
  try {
    await $fetch('/api/synced-folders', {
      method: 'POST',
      body: { path },
    })
    await refreshFolders()
  }
  catch (err) {
    if (err instanceof Error && 'statusCode' in err) {
      const status = (err as any).statusCode
      if (status === 409)
        folderAddError.value = t('settings.folders.errors.duplicateOrNested')
      else if (status === 400)
        folderAddError.value = t('settings.folders.errors.invalidPath')
      else
        folderAddError.value = t('settings.folders.errors.unknown')
    }
    else {
      folderAddError.value = t('settings.folders.errors.unknown')
    }
  }
  finally {
    folderAdding.value = false
  }
}

async function deleteFolder(id: string) {
  folderAddError.value = ''
  folderDeleteErrorId.value = ''
  folderDeleteError.value = ''
  try {
    await $fetch(`/api/synced-folders/${id}`, { method: 'DELETE' })
    await refreshFolders()
  }
  catch (err) {
    folderDeleteErrorId.value = id
    if (err instanceof Error && 'statusCode' in err && (err as any).statusCode === 404)
      folderDeleteError.value = t('settings.folders.errors.unknown')
    else
      folderDeleteError.value = t('settings.folders.errors.unknown')
  }
}

async function saveFolderAlias(id: string, alias: string | null) {
  folderAliasErrorId.value = ''
  folderAliasError.value = ''
  try {
    await $fetch(`/api/synced-folders/${id}`, {
      method: 'PATCH',
      body: { alias },
    })
    await refreshFolders()
  }
  catch (err) {
    folderAliasErrorId.value = id
    if (err instanceof Error && 'statusCode' in err && (err as any).statusCode === 400)
      folderAliasError.value = t('settings.folders.errors.aliasTooLong')
    else
      folderAliasError.value = t('settings.folders.errors.unknown')
  }
}

function normalisedFolders(): SyncedFolder[] {
  return Array.isArray(folders.value)
    ? folders.value.map(f => ({
        id: f.id,
        path: f.path,
        basename: f.basename,
        noteCount: f.noteCount,
        alias: f.alias ?? null,
      }))
    : []
}

const wizardStepActive = ref('folder')

function setWizardStep(id: string) {
  if (id === 'llm' && !hasFolder.value)
    return
  if (id === 'verify' && (!hasFolder.value || !llmConfigured.value || !hasRedis.value))
    return
  wizardStepActive.value = id
}

function isWizardStepActive(id: string) {
  return wizardStepActive.value === id
}

function stepClasses(complete: boolean, active: boolean) {
  const base = 'flex items-center gap-3 rounded-lg border px-4 py-3 text-sm font-medium transition-colors'
  if (complete)
    return `${base} border-green-200 bg-green-50 text-green-800`
  if (active)
    return `${base} border-indigo-200 bg-indigo-50 text-indigo-800`
  return `${base} border-gray-200 bg-white text-gray-600`
}

function stepNumberClasses(complete: boolean) {
  const base = 'flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold'
  if (complete)
    return `${base} bg-green-600 text-white`
  return `${base} bg-indigo-600 text-white`
}

function stepNumberDisplay(complete: boolean, number: number) {
  return complete ? '✓' : `${number}`
}

function stepCursorClass(id: string) {
  if (id === 'llm' && !hasFolder.value)
    return 'cursor-not-allowed'
  if (id === 'verify' && (!hasFolder.value || !llmConfigured.value || !hasRedis.value))
    return 'cursor-not-allowed'
  return 'cursor-pointer'
}

function stepActiveRing(id: string) {
  return isWizardStepActive(id) ? 'ring-2 ring-indigo-500 ring-offset-2' : ''
}

function stepCombinedClasses(step: { id: string, complete: boolean }) {
  return `${stepClasses(step.complete, isWizardStepActive(step.id))} ${stepCursorClass(step.id)} ${stepActiveRing(step.id)}`
}

async function onVerifyComplete() {
  verifyComplete.value = true
  emit('complete')
}

const folderList = computed(() => normalisedFolders())
const addingOrLoading = computed(() => folderAdding.value || foldersPending.value)
const noRedisBlock = computed(() => !hasRedis.value)
</script>

<template>
  <div class="container mx-auto max-w-3xl px-6 py-10">
    <div class="flex items-center gap-3">
      <RocketLaunchIcon class="h-7 w-7 text-indigo-600" />
      <h1 class="text-2xl font-bold text-gray-900">
        {{ t('settings.wizard.title') }}
      </h1>
    </div>

    <p class="mt-2 text-sm text-gray-600">
      {{ t('settings.wizard.subtitle') }}
    </p>

    <div v-if="pending" class="mt-8 text-gray-500">
      {{ t('chat.streaming') }}
    </div>

    <div v-else class="mt-8 space-y-6">
      <!-- Redis hard block -->
      <div v-if="noRedisBlock" class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <div class="flex items-start gap-2">
          <ExclamationTriangleIcon class="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" />
          <div>
            <p class="font-medium">
              {{ t('settings.wizard.redisWarning') }}
            </p>
            <p class="mt-1">
              {{ t('settings.wizard.redisHelp') }}
            </p>
          </div>
        </div>
      </div>

      <!-- Progress steps -->
      <div class="mb-6 grid gap-3 sm:grid-cols-3">
        <button
          v-for="(step, index) in wizardSteps"
          :key="step.id"
          type="button"
          class="text-left"
          :class="stepCombinedClasses(step)"
          :data-testid="`wizard-step-${step.id}`"
          :disabled="(step.id === 'llm' && !hasFolder) || (step.id === 'verify' && (!hasFolder || !llmConfigured || !hasRedis))"
          @click="setWizardStep(step.id)"
        >
          <span :class="stepNumberClasses(step.complete)">
            {{ stepNumberDisplay(step.complete, index + 1) }}
          </span>
          <span class="truncate">{{ step.label }}</span>
        </button>
      </div>

      <!-- Step 1: Synced folder -->
      <div v-if="isWizardStepActive('folder')" class="rounded-lg border border-gray-200 bg-white p-5">
        <div class="mb-4 flex items-center gap-2">
          <FolderIcon class="h-5 w-5 text-indigo-600" />
          <h2 class="text-lg font-semibold text-gray-900">
            {{ t('settings.wizard.steps.folder.title') }}
          </h2>
        </div>

        <p class="text-sm text-gray-600">
          {{ t('settings.wizard.steps.folder.help') }}
        </p>

        <div class="mt-4">
          <div v-if="hasFolder" class="mb-4 rounded-md bg-green-50 p-3 text-sm font-medium text-green-700">
            <CheckCircleIcon class="inline h-4 w-4" />
            {{ t('settings.wizard.steps.folder.complete') }}
          </div>

          <SyncedFolderManager
            :folders="folderList"
            :adding="addingOrLoading"
            :add-error="folderAddError"
            :delete-error-id="folderDeleteErrorId"
            :delete-error="folderDeleteError"
            :alias-error-id="folderAliasErrorId"
            :alias-error="folderAliasError"
            @add="addFolder"
            @delete="deleteFolder"
            @save-alias="saveFolderAlias"
          />
        </div>
      </div>

      <!-- Step 2: LLM roles -->
      <div v-if="isWizardStepActive('llm')" class="rounded-lg border border-gray-200 bg-white p-5">
        <div class="mb-4 flex items-center gap-2">
          <SparklesIcon class="h-5 w-5 text-indigo-600" />
          <h2 class="text-lg font-semibold text-gray-900">
            {{ t('settings.wizard.steps.llm.title') }}
          </h2>
        </div>

        <p class="text-sm text-gray-600">
          {{ t('settings.wizard.steps.llm.help') }}
        </p>

        <div v-if="llmConfigured" class="mb-4 mt-4 rounded-md bg-green-50 p-3 text-sm font-medium text-green-700">
          <CheckCircleIcon class="inline h-4 w-4" />
          {{ t('settings.wizard.steps.llm.complete') }}
        </div>

        <div v-if="!hasFolder" class="mt-4 rounded-md bg-gray-50 p-3 text-sm text-gray-600">
          {{ t('settings.wizard.steps.llm.locked') }}
        </div>

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
      </div>

      <!-- Step 3: Verify -->
      <div v-if="isWizardStepActive('verify')" class="mt-6">
        <WizardStepVerify
          :has-folder="hasFolder"
          :has-redis="hasRedis"
          :llm-configured="llmConfigured"
          @complete="onVerifyComplete"
        />
      </div>
    </div>
  </div>
</template>
