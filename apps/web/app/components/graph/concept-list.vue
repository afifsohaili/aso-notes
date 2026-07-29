<script setup lang="ts">
import type { ConceptSummary } from '~/server/lib/graph/ui'
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

const filteredConcepts = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q)
    return props.concepts
  return props.concepts.filter(c => c.name.toLowerCase().includes(q))
})

const groups = computed(() => groupConceptsByTopic(filteredConcepts.value))
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
          class="border-b border-gray-100 last:border-b-0"
        >
          <h3 class="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">
            {{ group.topic ?? t('graph.ungrouped') }}
          </h3>
          <ul class="divide-y divide-gray-200">
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
