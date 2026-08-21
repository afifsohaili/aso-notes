<script setup lang="ts">
import type { UsageSummary } from '~/types/usage-summary'
import { useI18n } from 'vue-i18n'
import { formatCost, formatTokens } from '~/utils/format-observability'

const props = defineProps<{
  summary: UsageSummary | null
  pending?: boolean
  error?: boolean
}>()

const { t } = useI18n()

function formatGenerations(n: number): string {
  return n.toLocaleString()
}

const anyMissing = computed(() => {
  return (props.summary?.total.usageMissingGenerations ?? 0) > 0
})

const rangeOrder: Array<{ key: 'today' | 'last7d' | 'last30d', labelKey: string }> = [
  { key: 'today', labelKey: 'settings.usage.ranges.today' },
  { key: 'last7d', labelKey: 'settings.usage.ranges.last7d' },
  { key: 'last30d', labelKey: 'settings.usage.ranges.last30d' },
]
</script>

<template>
  <div>
    <div v-if="pending && !summary" class="text-sm text-gray-500">
      {{ t('settings.usage.loading') }}
    </div>

    <div v-else-if="error || !summary" class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      {{ t('settings.usage.error') }}
    </div>

    <div v-else class="space-y-6">
      <div>
        <h2 class="text-lg font-semibold text-gray-900">
          {{ t('settings.usage.title') }}
        </h2>
        <p class="mt-1 text-sm text-gray-600">
          {{ t('settings.usage.description') }}
        </p>
      </div>

      <div
        v-if="anyMissing"
        class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
        data-testid="usage-missing-notice"
      >
        {{ t('settings.usage.usageMissing', { count: summary.total.usageMissingGenerations }) }}
      </div>

      <!-- Horizontal summary cards -->
      <div class="space-y-3">
        <div
          v-for="range in rangeOrder"
          :key="range.key"
          class="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-gray-200 bg-white p-4"
          :data-testid="`usage-card-${range.key}`"
        >
          <span class="text-sm font-medium text-gray-500">
            {{ t(range.labelKey) }}
          </span>
          <div class="flex flex-wrap items-center gap-6">
            <div class="text-right">
              <p class="text-lg font-semibold text-gray-900">
                {{ formatCost(summary.ranges[range.key].costUsd) }}
              </p>
              <p class="text-xs text-gray-500">
                {{ t('settings.usage.costLabel') }}
              </p>
            </div>
            <div class="text-right">
              <p class="text-lg font-semibold text-gray-900">
                {{ formatTokens(summary.ranges[range.key].tokens) }}
              </p>
              <p class="text-xs text-gray-500">
                {{ t('settings.usage.tokensLabel') }}
              </p>
            </div>
            <div class="text-right">
              <p class="text-lg font-semibold text-gray-900">
                {{ formatGenerations(summary.ranges[range.key].generations) }}
              </p>
              <p class="text-xs text-gray-500">
                {{ t('settings.usage.generationsLabel') }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Grouped usage table -->
      <div v-if="summary.groups.length > 0" class="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table class="min-w-full divide-y divide-gray-200 text-sm">
          <thead class="bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
            <tr>
              <th class="px-4 py-3">
                {{ t('settings.usage.table.useCase') }}
              </th>
              <th class="px-4 py-3">
                {{ t('settings.usage.table.model') }}
              </th>
              <th class="px-4 py-3 text-right">
                {{ t('settings.usage.table.generations') }}
              </th>
              <th class="px-4 py-3 text-right">
                {{ t('settings.usage.table.tokens') }}
              </th>
              <th class="px-4 py-3 text-right">
                {{ t('settings.usage.table.cost') }}
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100">
            <tr v-for="row in summary.groups" :key="`${row.useCase}-${row.model}`" class="hover:bg-gray-50">
              <td class="px-4 py-3 font-medium text-gray-900">
                {{ row.useCase }}
              </td>
              <td class="px-4 py-3 text-gray-600">
                {{ row.model }}
              </td>
              <td class="px-4 py-3 text-right text-gray-600">
                <span class="inline-flex items-center gap-1.5">
                  {{ formatGenerations(row.generations) }}
                  <span
                    v-if="row.usageMissingGenerations > 0"
                    class="rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700"
                    :title="t('settings.usage.usageMissing', { count: row.usageMissingGenerations })"
                  >
                    {{ t('settings.usage.usageMissingBadge') }}
                  </span>
                </span>
              </td>
              <td class="px-4 py-3 text-right text-gray-600">
                {{ formatTokens(row.tokens) }}
              </td>
              <td class="px-4 py-3 text-right font-medium text-gray-900">
                {{ formatCost(row.costUsd) }}
              </td>
            </tr>
          </tbody>
          <tfoot class="bg-gray-50 text-sm font-semibold text-gray-900">
            <tr>
              <td class="px-4 py-3" colspan="2">
                {{ t('settings.usage.table.total') }}
              </td>
              <td class="px-4 py-3 text-right">
                {{ formatGenerations(summary.total.generations) }}
              </td>
              <td class="px-4 py-3 text-right">
                {{ formatTokens(summary.total.tokens) }}
              </td>
              <td class="px-4 py-3 text-right">
                {{ formatCost(summary.total.costUsd) }}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div
        v-else
        class="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-8 text-center text-sm text-gray-500"
      >
        {{ t('settings.usage.empty') }}
      </div>
    </div>
  </div>
</template>
