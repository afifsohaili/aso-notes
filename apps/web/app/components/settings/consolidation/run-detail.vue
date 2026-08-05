<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import ExclamationTriangleIcon from '~icons/heroicons/exclamation-triangle'
import XCircleIcon from '~icons/heroicons/x-circle'

const { run } = defineProps<{
  run: ConsolidationRun
}>()

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

function formatDate(iso: string) {
  const date = new Date(iso)
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function percent(value: number) {
  return `${(value * 100).toFixed(0)}%`
}

function fixed(value: number) {
  return value.toFixed(1)
}

function totalTokens() {
  const u = run.usage
  return u ? u.promptTokens + u.completionTokens : null
}
</script>

<template>
  <div class="space-y-5">
    <!-- Header -->
    <div class="rounded-lg border border-gray-200 bg-white p-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 class="text-sm font-semibold text-gray-900">
            {{ formatDate(run.startedAt) }} · {{ t(`settings.consolidation.mode.${run.mode}`) }}
          </h3>
          <p v-if="run.finishedAt" class="mt-0.5 text-xs text-gray-500">
            {{ t('settings.consolidation.finishedAt', { time: formatDate(run.finishedAt) }) }}
          </p>
        </div>
        <span class="text-xs text-gray-500">
          <span v-if="totalTokens() !== null">{{ t('settings.consolidation.tokens', { count: totalTokens() }) }}</span>
          <span v-else>{{ t('settings.consolidation.judgeCalls', { count: run.counts.judgeCalls }) }}</span>
        </span>
      </div>

      <!-- Change counts -->
      <div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div class="rounded-md bg-gray-50 p-2 text-center">
          <p class="text-lg font-semibold text-gray-900">
            {{ run.counts.merges }}
          </p>
          <p class="text-xs text-gray-500">
            {{ t('settings.consolidation.counts.merges') }}
          </p>
        </div>
        <div class="rounded-md bg-gray-50 p-2 text-center">
          <p class="text-lg font-semibold text-gray-900">
            {{ run.counts.prunes }}
          </p>
          <p class="text-xs text-gray-500">
            {{ t('settings.consolidation.counts.prunes') }}
          </p>
        </div>
        <div class="rounded-md bg-gray-50 p-2 text-center">
          <p class="text-lg font-semibold text-gray-900">
            {{ run.counts.refiles }}
          </p>
          <p class="text-xs text-gray-500">
            {{ t('settings.consolidation.counts.refiles') }}
          </p>
        </div>
        <div class="rounded-md bg-gray-50 p-2 text-center">
          <p class="text-lg font-semibold text-gray-900">
            {{ run.counts.rewrites }}
          </p>
          <p class="text-xs text-gray-500">
            {{ t('settings.consolidation.counts.rewrites') }}
          </p>
        </div>
        <div class="rounded-md bg-gray-50 p-2 text-center">
          <p class="text-lg font-semibold text-gray-900">
            {{ run.counts.dissolves }}
          </p>
          <p class="text-xs text-gray-500">
            {{ t('settings.consolidation.counts.dissolves') }}
          </p>
        </div>
      </div>

      <!-- Flags -->
      <div v-if="run.flags.overPruning || run.flags.ineffectiveness" class="mt-4 space-y-2">
        <div
          v-if="run.flags.overPruning"
          class="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800"
          role="alert"
        >
          <p class="flex items-start gap-2">
            <ExclamationTriangleIcon class="mt-0.5 h-4 w-4 flex-shrink-0" />
            {{ t('settings.consolidation.flags.overPruning') }}
          </p>
        </div>
        <div
          v-if="run.flags.ineffectiveness"
          class="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800"
          role="alert"
        >
          <p class="flex items-start gap-2">
            <ExclamationTriangleIcon class="mt-0.5 h-4 w-4 flex-shrink-0" />
            {{ t('settings.consolidation.flags.ineffectiveness') }}
          </p>
        </div>
      </div>

      <!-- Error -->
      <div
        v-if="run.error"
        class="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800"
        role="alert"
      >
        <p class="flex items-start gap-2">
          <XCircleIcon class="mt-0.5 h-4 w-4 flex-shrink-0" />
          {{ run.error }}
        </p>
      </div>
    </div>

    <!-- Metrics -->
    <div class="rounded-lg border border-gray-200 bg-white p-5">
      <h3 class="text-sm font-semibold text-gray-900">
        {{ t('settings.consolidation.metrics.title') }}
      </h3>

      <div class="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div>
          <p class="text-xs text-gray-500">
            {{ t('settings.consolidation.metrics.concepts') }}
          </p>
          <p class="text-sm font-medium text-gray-900">
            {{ run.metricsBefore.concepts }} → {{ run.metricsAfter.concepts }}
          </p>
        </div>
        <div>
          <p class="text-xs text-gray-500">
            {{ t('settings.consolidation.metrics.topics') }}
          </p>
          <p class="text-sm font-medium text-gray-900">
            {{ run.metricsBefore.topics }} → {{ run.metricsAfter.topics }}
          </p>
        </div>
        <div>
          <p class="text-xs text-gray-500">
            {{ t('settings.consolidation.metrics.nearDupeRate') }}
          </p>
          <p class="text-sm font-medium text-gray-900">
            {{ percent(run.metricsBefore.nearDupeRate) }} → {{ percent(run.metricsAfter.nearDupeRate) }}
          </p>
        </div>
        <div>
          <p class="text-xs text-gray-500">
            {{ t('settings.consolidation.metrics.orphanRate') }}
          </p>
          <p class="text-sm font-medium text-gray-900">
            {{ percent(run.metricsBefore.orphanRate) }} → {{ percent(run.metricsAfter.orphanRate) }}
          </p>
        </div>
        <div>
          <p class="text-xs text-gray-500">
            {{ t('settings.consolidation.metrics.conceptsPerNote') }}
          </p>
          <p class="text-sm font-medium text-gray-900">
            {{ fixed(run.metricsBefore.conceptsPerNote) }} → {{ fixed(run.metricsAfter.conceptsPerNote) }}
          </p>
        </div>
        <div>
          <p class="text-xs text-gray-500">
            {{ t('settings.consolidation.metrics.topicSpread') }}
          </p>
          <p class="text-sm font-medium text-gray-900">
            {{ fixed(run.metricsBefore.topicSpread) }} → {{ fixed(run.metricsAfter.topicSpread) }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
