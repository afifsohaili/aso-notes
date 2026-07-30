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
  noteCount: number
}

interface ProviderAvailabilityPayload {
  providers: Record<LlmRole, ProviderAvailability>
}

const VOCABULARY_STRATEGIES = ['top-k', 'blind-merge', 'full'] as const
const LLM_ROLES: LlmRole[] = ['agent', 'extraction', 'embedding']

const DEFAULT_PROVIDER_AVAILABILITY: ProviderAvailability = { openrouter: true, ollama: true }

const { t } = useI18n()

const { data: payload, pending, refresh: refreshSettings } = await useFetch<SettingsPayload>('/api/settings')
const { data: statusCounts, refresh: refreshStatusCounts } = await useFetch('/api/notes/status-counts')
const { data: folders, pending: foldersPending, refresh: refreshFolders } = await useFetch<SyncedFolderApiItem[]>('/api/synced-folders')
const { data: availabilityPayload } = await useFetch<ProviderAvailabilityPayload>('/api/settings/providers')
const { data: ingestionStatus } = await useFetch<IngestionStatusResponse>('/api/ingestion/status')

const strategy = ref<typeof VOCABULARY_STRATEGIES[number]>('top-k')
const threshold = ref<number | ''>('')
const strategySaveStatus = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')

const showRebuildDialog = ref(false)
const rebuildConfirmText = ref('')
const rebuildStatus = ref<'idle' | 'loading' | 'success' | 'error'>('idle')
const rebuildError = ref('')
const verifyComplete = ref(false)
const showReverify = ref(false)

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

const showThreshold = computed(() => strategy.value === 'blind-merge')

async function saveStrategy() {
  strategySaveStatus.value = 'saving'
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

    await refreshSettings()
    strategySaveStatus.value = 'saved'
  }
  catch {
    strategySaveStatus.value = 'error'
  }
}

function onStrategyChange() {
  strategySaveStatus.value = 'idle'
  if (strategy.value === 'blind-merge' && threshold.value === '') {
    threshold.value = 0.85
  }
}

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

const isWizardMode = computed(() => {
  const completed = payload.value?.settings?.['onboarding.completed_at']?.value
  return !completed || typeof completed !== 'string'
})

const wizardSteps = computed(() => [
  { id: 'folder', label: t('settings.wizard.steps.folder.title'), complete: hasFolder.value },
  { id: 'llm', label: t('settings.wizard.steps.llm.title'), complete: llmConfigured.value },
  { id: 'verify', label: t('settings.wizard.steps.verify.title'), complete: verifyComplete.value || !isWizardMode.value },
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

    await refreshSettings()
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
    if (err instanceof Error && 'statusCode' in err) {
      const status = (err as any).statusCode
      if (status === 409) {
        folderDeleteErrorId.value = id
        folderDeleteError.value = t('settings.folders.errors.hasNotes')
      }
      else {
        folderDeleteError.value = t('settings.folders.errors.unknown')
      }
    }
    else {
      folderDeleteError.value = t('settings.folders.errors.unknown')
    }
  }
}

function normalisedFolders(): SyncedFolder[] {
  return Array.isArray(folders.value)
    ? folders.value.map(f => ({
        id: f.id,
        path: f.path,
        noteCount: f.noteCount,
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

const { refresh: refreshOnboarding } = useOnboardingStatus()

async function onVerifyComplete() {
  verifyComplete.value = true
  await refreshSettings()
  await refreshOnboarding()
}

function openReverify() {
  showReverify.value = true
}

function closeReverify() {
  showReverify.value = false
}

watch(isWizardMode, async (wizard) => {
  if (!wizard)
    await refreshOnboarding()
}, { immediate: true })

const titleText = computed(() => isWizardMode.value ? t('settings.wizard.title') : t('settings.title'))
const subtitleText = computed(() => isWizardMode.value ? t('settings.wizard.subtitle') : '')
const folderList = computed(() => normalisedFolders())
const addingOrLoading = computed(() => folderAdding.value || foldersPending.value)
const noRedisBlock = computed(() => isWizardMode.value && !hasRedis.value)
</script>

<template>
  <div class="container mx-auto px-6 py-10" :class="isWizardMode ? 'max-w-3xl' : 'max-w-2xl'">
    <div class="flex items-center gap-3">
      <RocketLaunchIcon v-if="isWizardMode" class="h-7 w-7 text-indigo-600" />
      <h1 class="text-2xl font-bold text-gray-900">
        {{ titleText }}
      </h1>
    </div>

    <p v-if="isWizardMode" class="mt-2 text-sm text-gray-600">
      {{ subtitleText }}
    </p>

    <div v-if="pending" class="mt-8 text-gray-500">
      {{ t('chat.streaming') }}
    </div>

    <div v-else class="mt-8">
      <!-- Wizard mode -->
      <div v-if="isWizardMode" class="space-y-6">
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
              @add="addFolder"
              @delete="deleteFolder"
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

      <!-- Steady state -->
      <div v-else class="space-y-6">
        <!-- Synced folders -->
        <section class="mt-8">
          <h2 class="text-lg font-semibold text-gray-900">
            {{ t('settings.folders.title') }}
          </h2>
          <p class="mt-1 text-sm text-gray-600">
            {{ t('settings.folders.help') }}
          </p>

          <div class="mt-4">
            <SyncedFolderManager
              :folders="folderList"
              :adding="addingOrLoading"
              :add-error="folderAddError"
              :delete-error-id="folderDeleteErrorId"
              :delete-error="folderDeleteError"
              @add="addFolder"
              @delete="deleteFolder"
            />
          </div>
        </section>

        <!-- LLM configuration -->
        <section class="mt-8">
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

        <!-- Re-verify setup -->
        <section class="mt-8">
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

        <!-- Extraction strategy -->
        <form class="mt-8 space-y-6" @submit.prevent="saveStrategy">
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
              @input="strategySaveStatus = 'idle'"
            >
          </div>

          <div class="flex items-center gap-4">
            <button
              type="submit"
              :disabled="strategySaveStatus === 'saving'"
              class="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {{ t('settings.save') }}
            </button>

            <span
              v-if="strategySaveStatus === 'saved'"
              class="text-sm font-medium text-green-600"
              role="status"
            >
              {{ t('settings.saved') }}
            </span>

            <span
              v-if="strategySaveStatus === 'error'"
              class="text-sm font-medium text-red-600"
              role="alert"
            >
              {{ t('settings.saveError') }}
            </span>
          </div>
        </form>

        <!-- Danger zone -->
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
      </div>
    </div>

    <!-- Rebuild dialog -->
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
          {{ rebuildError || t('settings.saveError') }}
        </p>
      </div>
    </div>
  </div>
</template>
