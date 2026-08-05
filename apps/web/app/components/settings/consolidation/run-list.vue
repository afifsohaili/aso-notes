<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import ExclamationTriangleIcon from '~icons/heroicons/exclamation-triangle'

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
  flags: { overPruning: boolean, ineffectiveness: boolean }
}

defineProps<{
  runs: ConsolidationRun[]
  selectedId: string | null
}>()

const emit = defineEmits<{
  (e: 'select', id: string): void
}>()

const { t } = useI18n()

function totalChanges(run: ConsolidationRun) {
  return run.counts.merges + run.counts.prunes + run.counts.rewrites + run.counts.dissolves + run.counts.refiles
}

function hasFlag(run: ConsolidationRun) {
  return run.flags.overPruning || run.flags.ineffectiveness
}

function formatDate(iso: string) {
  const date = new Date(iso)
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function statusClass(status: ConsolidationRun['status']) {
  if (status === 'completed')
    return 'bg-green-50 text-green-700'
  if (status === 'failed')
    return 'bg-red-50 text-red-700'
  return 'bg-indigo-50 text-indigo-700'
}
</script>

<template>
  <div class="space-y-1" data-testid="run-list">
    <button
      v-for="run in runs"
      :key="run.id"
      type="button"
      class="block w-full rounded-md px-3 py-2 text-left transition-colors"
      :class="run.id === selectedId ? 'bg-indigo-50' : 'hover:bg-gray-100'"
      data-testid="run-list-item"
      @click="emit('select', run.id)"
    >
      <div class="flex items-center justify-between">
        <span class="text-sm font-medium text-gray-900">
          {{ formatDate(run.finishedAt ?? run.startedAt) }}
        </span>
        <span
          class="rounded-full px-2 py-0.5 text-xs font-medium"
          :class="statusClass(run.status)"
        >
          {{ t(`settings.consolidation.status.${run.status}`) }}
        </span>
      </div>

      <div class="mt-0.5 flex items-center justify-between text-xs text-gray-500">
        <span class="uppercase">{{ t(`settings.consolidation.mode.${run.mode}`) }}</span>
        <span v-if="hasFlag(run)" class="inline-flex items-center gap-0.5 text-amber-600">
          <ExclamationTriangleIcon class="h-3 w-3" />
          {{ t('settings.consolidation.flag') }}
        </span>
      </div>

      <div class="mt-1 text-xs text-gray-500">
        {{ t('settings.consolidation.changesCount', { count: totalChanges(run) }) }}
      </div>
    </button>

    <p v-if="runs.length === 0" class="py-4 text-center text-sm text-gray-500">
      {{ t('settings.consolidation.emptyHistory') }}
    </p>
  </div>
</template>
