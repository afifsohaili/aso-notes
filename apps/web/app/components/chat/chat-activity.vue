<script setup lang="ts">
import type { ChatActivity } from '~/composables/use-chat'
import { useI18n } from 'vue-i18n'
import ChevronDownIcon from '~icons/heroicons/chevron-down'
import ChevronRightIcon from '~icons/heroicons/chevron-right'
import WrenchIcon from '~icons/heroicons/wrench'

const props = defineProps<{
  activities: ChatActivity[]
}>()

const { t } = useI18n()
const expanded = ref<Set<string>>(new Set())
const panelCollapsed = ref(false)

const pendingCount = computed(() => props.activities.filter(a => a.status === 'pending').length)

function isExpanded(toolCallId: string): boolean {
  return expanded.value.has(toolCallId)
}

function toggle(toolCallId: string) {
  const next = new Set(expanded.value)
  if (next.has(toolCallId))
    next.delete(toolCallId)
  else
    next.add(toolCallId)
  expanded.value = next
}

function expandAll() {
  expanded.value = new Set(props.activities.map(a => a.toolCallId))
}

function collapseAll() {
  expanded.value = new Set()
}

function argsSummary(args: Record<string, unknown>): string {
  const salient = args.query ?? args.path ?? args.name ?? args.url ?? args.concept ?? args.conceptId
  if (typeof salient === 'string')
    return salient.length > 60 ? `${salient.slice(0, 60)}…` : salient
  const json = JSON.stringify(args)
  return json.length > 60 ? `${json.slice(0, 60)}…` : json
}

function resultSummary(activity: ChatActivity): string {
  if (activity.status === 'pending')
    return t('chat.running')
  return summarizeResult(activity.result)
}

function summarizeResult(result: unknown): string {
  if (result && typeof result === 'object') {
    for (const [key, value] of Object.entries(result as Record<string, unknown>)) {
      if (Array.isArray(value))
        return `${value.length} ${key}`
    }
    if ('notFound' in (result as Record<string, unknown>))
      return t('chat.notFound')
  }
  return t('chat.done')
}

function format(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  }
  catch {
    return String(value)
  }
}
</script>

<template>
  <div class="shrink-0 border-t border-gray-200 bg-gray-50 flex flex-col max-h-72">
    <div class="flex items-center justify-between px-4 py-2">
      <button
        type="button"
        class="flex items-center gap-2 text-xs font-semibold text-gray-500 uppercase tracking-wider hover:text-gray-700"
        @click="panelCollapsed = !panelCollapsed"
      >
        <component :is="panelCollapsed ? ChevronRightIcon : ChevronDownIcon" class="h-3.5 w-3.5" />
        {{ t('chat.activity') }} ({{ activities.length }})
        <span v-if="pendingCount > 0" class="text-amber-600 normal-case">
          {{ pendingCount }} {{ t('chat.running') }}
        </span>
      </button>
      <div v-if="!panelCollapsed" class="flex items-center gap-2 text-xs">
        <button type="button" class="text-indigo-600 hover:text-indigo-800" @click="expandAll">
          {{ t('chat.expandAll') }}
        </button>
        <span class="text-gray-300">|</span>
        <button type="button" class="text-indigo-600 hover:text-indigo-800" @click="collapseAll">
          {{ t('chat.collapseAll') }}
        </button>
      </div>
    </div>

    <ul v-if="!panelCollapsed" class="overflow-y-auto px-4 pb-3 space-y-1.5">
      <li
        v-for="activity in props.activities"
        :key="activity.toolCallId"
        class="bg-white border border-gray-200 rounded-md overflow-hidden"
      >
        <button
          type="button"
          class="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-gray-50"
          @click="toggle(activity.toolCallId)"
        >
          <span
            class="shrink-0 h-2 w-2 rounded-full"
            :class="activity.status === 'pending' ? 'bg-amber-400 animate-pulse' : 'bg-green-500'"
          />
          <WrenchIcon class="shrink-0 h-3.5 w-3.5 text-gray-400" />
          <span class="text-sm font-medium text-gray-900">{{ activity.name }}</span>
          <span class="text-xs text-gray-500 truncate">{{ argsSummary(activity.args) }}</span>
          <span class="ml-auto shrink-0 text-xs text-gray-400">{{ resultSummary(activity) }}</span>
          <component :is="isExpanded(activity.toolCallId) ? ChevronDownIcon : ChevronRightIcon" class="shrink-0 h-3.5 w-3.5 text-gray-400" />
        </button>

        <div v-if="isExpanded(activity.toolCallId)" class="px-3 pb-3 text-xs text-gray-700 space-y-2 border-t border-gray-100">
          <div>
            <p class="font-semibold text-gray-500 mt-2 mb-1">
              {{ t('chat.input') }}
            </p>
            <pre class="bg-gray-100 p-2 rounded overflow-x-auto">{{ format(activity.args) }}</pre>
          </div>
          <div>
            <p class="font-semibold text-gray-500 mb-1">
              {{ t('chat.result') }}
            </p>
            <pre v-if="activity.result !== undefined" class="bg-gray-100 p-2 rounded overflow-x-auto">{{ format(activity.result) }}</pre>
            <p v-else class="text-gray-400 italic">
              {{ t('chat.running') }}
            </p>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>
