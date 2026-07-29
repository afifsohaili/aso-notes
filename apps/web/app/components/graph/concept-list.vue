<script setup lang="ts">
import type { ConceptSummary } from '~/server/lib/graph/ui'
import { useI18n } from 'vue-i18n'
import ChevronDownIcon from '~icons/heroicons/chevron-down'
import ChevronRightIcon from '~icons/heroicons/chevron-right'
import SearchIcon from '~icons/heroicons/magnifying-glass'

const props = defineProps<{
  concepts: ConceptSummary[]
  selectedConceptId: string | null
}>()

const emit = defineEmits<{
  (e: 'select', conceptId: string): void
}>()

const { t } = useI18n()

const query = ref('')
const collapsedTopics = ref<Set<string>>(new Set())

const filteredConcepts = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q)
    return props.concepts
  return props.concepts.filter(c => c.name.toLowerCase().includes(q))
})

const groups = computed(() => groupConceptsByTopic(filteredConcepts.value))

function topicKey(group: { topic: string | null }): string {
  return group.topic ?? '__ungrouped__'
}

function isCollapsed(group: { topic: string | null }): boolean {
  return collapsedTopics.value.has(topicKey(group))
}

function toggleGroup(group: { topic: string | null }) {
  const key = topicKey(group)
  const next = new Set(collapsedTopics.value)
  if (next.has(key))
    next.delete(key)
  else
    next.add(key)
  collapsedTopics.value = next
}
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="p-3 border-b border-gray-200">
      <div class="relative">
        <SearchIcon class="absolute left-2.5 top-2 h-4 w-4 text-gray-400" />
        <input
          v-model="query"
          type="text"
          :placeholder="t('graph.searchConcepts')"
          class="block w-full pl-8 pr-3 py-1.5 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
        >
      </div>
    </div>

    <div class="flex-1 overflow-y-auto">
      <template v-if="groups.length > 0">
        <div
          v-for="group in groups"
          :key="group.topic ?? 'ungrouped'"
          data-testid="topic-group"
          class="border-b border-gray-100 last:border-b-0"
        >
          <button
            type="button"
            data-testid="topic-header"
            class="w-full px-4 py-2 flex items-center justify-between text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50 hover:bg-gray-100"
            :aria-label="isCollapsed(group) ? t('graph.expandGroup') : t('graph.collapseGroup')"
            @click="toggleGroup(group)"
          >
            <span>{{ group.topic ?? t('graph.ungrouped') }}</span>
            <ChevronDownIcon v-if="!isCollapsed(group)" class="h-4 w-4 text-gray-400" />
            <ChevronRightIcon v-else class="h-4 w-4 text-gray-400" />
          </button>
          <ul v-if="!isCollapsed(group)" data-testid="topic-concepts" class="divide-y divide-gray-200">
            <li
              v-for="concept in group.concepts"
              :key="concept.id"
              class="px-4 py-3 hover:bg-gray-50 cursor-pointer"
              :class="selectedConceptId === concept.id ? 'bg-indigo-50' : ''"
              @click="emit('select', concept.id)"
            >
              <div class="flex items-center justify-between">
                <p class="text-sm font-medium text-gray-900">
                  {{ concept.name }}
                </p>
                <span class="text-xs text-gray-500">
                  {{ concept.mentionCount }}
                </span>
              </div>
              <p v-if="concept.description" class="text-xs text-gray-500 mt-0.5 line-clamp-2">
                {{ concept.description }}
              </p>
            </li>
          </ul>
        </div>
      </template>

      <div v-else class="p-6 text-center text-sm text-gray-500">
        {{ concepts.length === 0 ? t('graph.empty') : t('graph.noSelection') }}
      </div>
    </div>
  </div>
</template>
