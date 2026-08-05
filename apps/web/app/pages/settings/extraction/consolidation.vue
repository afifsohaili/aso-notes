<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import ArrowLeftIcon from '~icons/heroicons/arrow-left'
import ConsolidationChangeFeed from '~/components/settings/consolidation/change-feed.vue'
import ConsolidationManualRunButton from '~/components/settings/consolidation/manual-run-button.vue'
import ConsolidationRestorePanel from '~/components/settings/consolidation/restore-panel.vue'
import ConsolidationRunDetail from '~/components/settings/consolidation/run-detail.vue'
import ConsolidationRunList from '~/components/settings/consolidation/run-list.vue'

definePageMeta({
  layout: 'settings',
})

const { t } = useI18n()

interface ConsolidationRun {
  id: string
  mode: 'incremental' | 'full' | 'manual'
  status: 'running' | 'completed' | 'failed'
  startedAt: string
  finishedAt: string | null
  counts: {
    merges: number
    prunes: number
    rewrites: number
    dissolves: number
    refiles: number
    judgeCalls: number
  }
  usage: { promptTokens: number, completionTokens: number, totalTokens: number } | null
  metricsBefore: {
    concepts: number
    topics: number
    nearDupeRate: number
    orphanRate: number
    conceptsPerNote: number
    topicSpread: number
  }
  metricsAfter: {
    concepts: number
    topics: number
    nearDupeRate: number
    orphanRate: number
    conceptsPerNote: number
    topicSpread: number
  }
  flags: { overPruning: boolean, ineffectiveness: boolean }
  error: string | null
}

const mobileView = ref<'list' | 'detail'>('list')
const selectedRunId = ref<string | null>(null)
const refreshInterval = ref<ReturnType<typeof setInterval> | null>(null)

const { data: runsData, refresh: refreshRuns } = useFetch('/api/consolidation/runs')

const runs = computed<ConsolidationRun[]>(() => runsData.value?.runs ?? [])
const selectedRun = computed<ConsolidationRun | undefined>(() => runs.value.find(r => r.id === selectedRunId.value))

const detailData = ref<{ run: ConsolidationRun, changes: unknown[], hasSnapshot: boolean } | null>(null)
const detailLoading = ref(false)

const hasRunningRun = computed(() => runs.value.some(r => r.status === 'running'))

watchEffect(() => {
  if (hasRunningRun.value && refreshInterval.value === null) {
    refreshInterval.value = setInterval(() => {
      refreshRuns()
      if (selectedRun.value)
        fetchDetail(selectedRun.value.id)
    }, 3000)
  }
  else if (!hasRunningRun.value && refreshInterval.value !== null) {
    clearInterval(refreshInterval.value)
    refreshInterval.value = null
  }
})

onBeforeUnmount(() => {
  if (refreshInterval.value !== null) {
    clearInterval(refreshInterval.value)
    refreshInterval.value = null
  }
})

watch(runs, (newRuns) => {
  if (selectedRunId.value === null && newRuns.length > 0)
    selectedRunId.value = newRuns[0]!.id
}, { immediate: true })

watch(selectedRunId, (id) => {
  if (id)
    fetchDetail(id)
  else
    detailData.value = null
}, { immediate: true })

async function fetchDetail(id: string) {
  detailLoading.value = true
  try {
    detailData.value = await $fetch(`/api/consolidation/runs/${id}`) as typeof detailData.value
  }
  finally {
    detailLoading.value = false
  }
}

function selectRun(id: string) {
  selectedRunId.value = id
  mobileView.value = 'detail'
}

function showList() {
  mobileView.value = 'list'
}

function onRestored() {
  refreshRuns()
  if (selectedRun.value)
    fetchDetail(selectedRun.value.id)
}
</script>

<template>
  <section>
    <div class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 class="text-lg font-semibold text-gray-900">
          {{ t('settings.consolidation.title') }}
        </h2>
        <p class="mt-1 text-sm text-gray-600">
          {{ t('settings.consolidation.description') }}
        </p>
      </div>
      <ConsolidationManualRunButton @run-created="refreshRuns" />
    </div>

    <div
      class="relative md:flex md:gap-6"
      data-testid="mobile-view"
      :data-view="mobileView"
    >
      <!-- Run list -->
      <div
        class="md:w-64 md:flex-shrink-0"
        :class="mobileView === 'detail' ? 'hidden md:block' : 'block'"
      >
        <ConsolidationRunList
          :runs="runs"
          :selected-id="selectedRunId"
          @select="selectRun"
        />
      </div>

      <!-- Detail pane -->
      <div
        v-if="selectedRun"
        class="md:min-w-0 md:flex-1"
        :class="mobileView === 'list' ? 'hidden md:block' : 'block'"
        data-testid="run-detail-pane"
      >
        <button
          type="button"
          class="mb-3 inline-flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900 md:hidden"
          data-testid="detail-back-button"
          @click="showList"
        >
          <ArrowLeftIcon class="h-4 w-4" />
          {{ t('settings.consolidation.backToHistory') }}
        </button>

        <ConsolidationRunDetail :run="selectedRun" />

        <ConsolidationChangeFeed
          class="mt-5"
          :changes="detailData?.changes ?? []"
        />

        <ConsolidationRestorePanel
          v-if="detailData?.hasSnapshot"
          class="mt-5"
          :run-id="selectedRun.id"
          @restored="onRestored"
        />
      </div>

      <div
        v-else
        class="flex flex-1 items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 p-10"
        :class="mobileView === 'list' ? 'hidden md:flex' : 'flex md:flex'"
      >
        <p class="text-sm text-gray-500">
          {{ t('settings.consolidation.noRuns') }}
        </p>
      </div>
    </div>
  </section>
</template>
