<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import ChevronDownIcon from '~icons/heroicons/chevron-down'
import ChevronRightIcon from '~icons/heroicons/chevron-right'

export interface ChatActivityItem {
  toolCallId: string
  name: string
  args: Record<string, unknown>
  result?: unknown
}

const props = defineProps<{
  activities: ChatActivityItem[]
}>()

const { t } = useI18n()
const expanded = ref<Set<string>>(new Set())

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
  <div class="border-t border-gray-200 bg-gray-50 p-4">
    <h3 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
      {{ t('chat.activity') }}
    </h3>
    <ul class="space-y-2">
      <li
        v-for="activity in props.activities"
        :key="activity.toolCallId"
        class="bg-white border border-gray-200 rounded-md overflow-hidden"
      >
        <button
          class="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-50"
          @click="toggle(activity.toolCallId)"
        >
          <span class="text-sm font-medium text-gray-900">
            {{ activity.name }}
          </span>
          <component :is="isExpanded(activity.toolCallId) ? ChevronDownIcon : ChevronRightIcon" class="h-4 w-4 text-gray-500" />
        </button>
        <div class="px-3 pb-3 text-xs text-gray-700 space-y-2">
          <pre class="bg-gray-100 p-2 rounded overflow-x-auto">{{ format(activity.args) }}</pre>
          <div v-if="isExpanded(activity.toolCallId) && activity.result !== undefined">
            <p class="font-semibold text-gray-500 mb-1">
              {{ t('chat.result') }}
            </p>
            <pre class="bg-gray-100 p-2 rounded overflow-x-auto">{{ format(activity.result) }}</pre>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>
