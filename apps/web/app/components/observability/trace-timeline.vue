<script setup lang="ts">
import type { Json } from '@monorepo/shared'
import { useI18n } from 'vue-i18n'
import ChevronDownIcon from '~icons/heroicons/chevron-down'
import CpuChipIcon from '~icons/heroicons/cpu-chip'
import WrenchScrewdriverIcon from '~icons/heroicons/wrench-screwdriver'
import { formatCost, formatMs, formatTokens } from '~/utils/format-observability'

export interface TraceGeneration {
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
}

export interface TraceToolCall {
  id: string
  seq: number
  name: string
  input: Json
  output: Json | null
  durationMs: number | null
  status: string
  prunedAt: string | null
  createdAt: string
}

const props = defineProps<{
  generations: TraceGeneration[]
  toolCalls: TraceToolCall[]
}>()

const { t } = useI18n()

interface TraceStep {
  kind: 'generation' | 'tool_call'
  seq: number
  item: TraceGeneration | TraceToolCall
}

const steps = computed<TraceStep[]>(() => {
  const genSteps: TraceStep[] = props.generations.map(g => ({ kind: 'generation', seq: g.seq, item: g }))
  const toolSteps: TraceStep[] = props.toolCalls.map(t => ({ kind: 'tool_call', seq: t.seq, item: t }))
  return [...genSteps, ...toolSteps].sort((a, b) => a.seq - b.seq)
})

const expanded = ref<Set<number>>(new Set(steps.value.map(s => s.seq)))

watch(() => props.generations, () => {
  expanded.value = new Set(steps.value.map(s => s.seq))
}, { immediate: true })

function isGenerationStep(step: TraceStep): step is TraceStep & { item: TraceGeneration } {
  return step.kind === 'generation'
}

function toggle(seq: number) {
  const next = new Set(expanded.value)
  if (next.has(seq))
    next.delete(seq)
  else
    next.add(seq)
  expanded.value = next
}

function generationSummary(gen: TraceGeneration): string {
  const parts: string[] = []
  const tokens = (gen.promptTokens ?? 0) + (gen.completionTokens ?? 0)
  if (tokens > 0)
    parts.push(t('chat.trace.tokens', { count: formatTokens(tokens) }))
  if (gen.costUsd)
    parts.push(formatCost(gen.costUsd))
  if (gen.latencyMs !== null)
    parts.push(formatMs(gen.latencyMs))
  if (gen.finishReason)
    parts.push(gen.finishReason)
  if (parts.length === 0)
    return t('chat.trace.usageMissing')
  return parts.join(' · ')
}

function toolCallSummary(tool: TraceToolCall): string {
  const parts: string[] = []
  if (tool.durationMs !== null)
    parts.push(formatMs(tool.durationMs))
  parts.push(tool.status)
  return parts.join(' · ')
}

function formatJson(value: Json): string {
  try {
    return JSON.stringify(value, null, 2)
  }
  catch {
    return String(value)
  }
}

function contentState(item: { prunedAt: string | null, value: Json | null }): { present: boolean, expired: boolean } {
  const present = item.value !== null
  return { present, expired: !present && item.prunedAt !== null }
}
</script>

<template>
  <ol class="space-y-3">
    <li
      v-for="step in steps"
      :key="step.seq"
      class="rounded-lg border border-gray-200 bg-white"
      :data-step-kind="step.kind"
    >
      <button
        type="button"
        class="flex w-full items-center gap-3 px-4 py-3 text-left"
        @click="toggle(step.seq)"
      >
        <component
          :is="isGenerationStep(step) ? CpuChipIcon : WrenchScrewdriverIcon"
          class="h-4 w-4 flex-shrink-0"
          :class="isGenerationStep(step) ? 'text-indigo-500' : 'text-amber-500'"
        />
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-gray-900">
            <template v-if="isGenerationStep(step)">
              {{ t('chat.trace.generation') }} · {{ step.item.model }}
            </template>
            <template v-else>
              {{ step.item.name }}
            </template>
          </p>
          <p class="text-xs text-gray-500">
            <template v-if="isGenerationStep(step)">
              {{ generationSummary(step.item) }}
            </template>
            <template v-else>
              {{ toolCallSummary(step.item) }}
            </template>
          </p>
        </div>
        <ChevronDownIcon
          class="h-4 w-4 flex-shrink-0 text-gray-400 transition-transform"
          :class="expanded.has(step.seq) ? 'rotate-180' : ''"
        />
      </button>

      <div
        v-if="expanded.has(step.seq)"
        class="border-t border-gray-100 px-4 py-3 text-xs"
      >
        <template v-if="isGenerationStep(step)">
          <div class="mb-3">
            <p class="mb-1 font-medium text-gray-500">
              {{ t('chat.trace.prompt') }}
            </p>
            <div v-if="contentState(step.item).present" class="max-h-48 overflow-y-auto rounded bg-gray-50">
              <pre class="whitespace-pre-wrap p-2 text-gray-700">{{ formatJson(step.item.prompt) }}</pre>
            </div>
            <p v-else-if="contentState(step.item).expired" class="italic text-gray-400">
              {{ t('chat.trace.expired') }}
            </p>
            <p v-else class="italic text-gray-400">
              {{ t('chat.trace.notRecorded') }}
            </p>
          </div>
          <div>
            <p class="mb-1 font-medium text-gray-500">
              {{ t('chat.trace.response') }}
            </p>
            <div v-if="step.item.response !== null" class="max-h-48 overflow-y-auto rounded bg-gray-50">
              <pre class="whitespace-pre-wrap p-2 text-gray-700">{{ formatJson(step.item.response) }}</pre>
            </div>
            <p v-else-if="step.item.prunedAt !== null" class="italic text-gray-400">
              {{ t('chat.trace.expired') }}
            </p>
            <p v-else class="italic text-gray-400">
              {{ t('chat.trace.notRecorded') }}
            </p>
          </div>
        </template>

        <template v-else>
          <div class="mb-3">
            <p class="mb-1 font-medium text-gray-500">
              {{ t('chat.trace.input') }}
            </p>
            <div class="max-h-48 overflow-y-auto rounded bg-gray-50">
              <pre class="whitespace-pre-wrap p-2 text-gray-700">{{ formatJson(step.item.input) }}</pre>
            </div>
          </div>
          <div>
            <p class="mb-1 font-medium text-gray-500">
              {{ t('chat.trace.output') }}
            </p>
            <div v-if="step.item.output !== null" class="max-h-48 overflow-y-auto rounded bg-gray-50">
              <pre class="whitespace-pre-wrap p-2 text-gray-700">{{ formatJson(step.item.output) }}</pre>
            </div>
            <p v-else-if="step.item.prunedAt !== null" class="italic text-gray-400">
              {{ t('chat.trace.expired') }}
            </p>
            <p v-else class="italic text-gray-400">
              {{ t('chat.trace.notRecorded') }}
            </p>
          </div>
        </template>
      </div>
    </li>
  </ol>
</template>
