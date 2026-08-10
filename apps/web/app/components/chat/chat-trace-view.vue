<script setup lang="ts">
import type { Json } from '@monorepo/shared'
import { useI18n } from 'vue-i18n'
import TraceTimeline from '~/components/observability/trace-timeline.vue'

export interface TraceResponse {
  trace: {
    id: string
    kind: string
    status: string
    ownerType: string
    ownerId: string
    startedAt: string
    finishedAt: string | null
    error: string | null
    createdAt: string
    updatedAt: string
  }
  generations: Array<{
    id: string
    seq: number
    llmUseCase: string
    provider: string
    model: string
    prompt: Json | null
    response: Json | null
    promptTokens: number | null
    completionTokens: number | null
    costUsd: string | null
    latencyMs: number | null
    finishReason: string | null
    error: string | null
    prunedAt: string | null
    usageMissing: boolean
    createdAt: string
  }>
  toolCalls: Array<{
    id: string
    seq: number
    name: string
    input: Json
    output: Json | null
    durationMs: number | null
    status: string
    prunedAt: string | null
    createdAt: string
  }>
  totalTokens: number
  totalCost: string
  durationMs: number | null
}

defineProps<{
  trace: TraceResponse | null | undefined
}>()

const { t } = useI18n()

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`
}

function formatCost(costUsd: string): string {
  return `$${Number.parseFloat(costUsd).toFixed(4)}`
}

function formatMs(ms: number | null): string {
  if (ms === null)
    return '—'
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

function statusClass(status: string): string {
  if (status === 'completed')
    return 'bg-green-100 text-green-800'
  if (status === 'failed')
    return 'bg-red-100 text-red-800'
  if (status === 'running')
    return 'bg-amber-100 text-amber-800'
  return 'bg-gray-100 text-gray-800'
}
</script>

<template>
  <div v-if="!trace" class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
    {{ t('chat.trace.error') }}
  </div>

  <template v-else>
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-lg font-semibold text-gray-900">
          {{ t('chat.trace.title') }}
        </h1>
        <p class="mt-0.5 text-xs text-gray-500">
          {{ formatDate(trace.trace.startedAt) }}
          <span v-if="trace.trace.finishedAt">→ {{ formatDate(trace.trace.finishedAt) }}</span>
        </p>
      </div>
      <span class="inline-flex items-center rounded px-2 py-1 text-xs font-medium" :class="statusClass(trace.trace.status)">
        {{ trace.trace.status }}
      </span>
    </div>

    <div class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div class="rounded-md bg-gray-50 p-2 text-center">
        <p class="text-sm font-semibold text-gray-900">
          {{ trace.generations.length + trace.toolCalls.length }}
        </p>
        <p class="text-xs text-gray-500">
          {{ t('chat.trace.steps', { count: trace.generations.length + trace.toolCalls.length }) }}
        </p>
      </div>
      <div class="rounded-md bg-gray-50 p-2 text-center">
        <p class="text-sm font-semibold text-gray-900">
          {{ formatTokens(trace.totalTokens) }}
        </p>
        <p class="text-xs text-gray-500">
          {{ t('chat.trace.tokens', { count: formatTokens(trace.totalTokens) }) }}
        </p>
      </div>
      <div class="rounded-md bg-gray-50 p-2 text-center">
        <p class="text-sm font-semibold text-gray-900">
          {{ formatCost(trace.totalCost) }}
        </p>
        <p class="text-xs text-gray-500">
          {{ t('chat.trace.cost') }}
        </p>
      </div>
      <div class="rounded-md bg-gray-50 p-2 text-center">
        <p class="text-sm font-semibold text-gray-900">
          {{ formatMs(trace.durationMs) }}
        </p>
        <p class="text-xs text-gray-500">
          {{ t('chat.trace.duration') }}
        </p>
      </div>
    </div>

    <div class="mt-6">
      <div v-if="trace.generations.length === 0 && trace.toolCalls.length === 0" class="text-center text-sm text-gray-500">
        {{ t('chat.trace.noSteps') }}
      </div>
      <TraceTimeline
        :generations="trace.generations"
        :tool-calls="trace.toolCalls"
      />
    </div>
  </template>
</template>
