<script setup lang="ts">
import type { ConceptDetail, GraphEdge, GraphNode } from '~/server/lib/graph/ui'
import { useI18n } from 'vue-i18n'
import QueueListIcon from '~icons/heroicons/queue-list'
import XMarkIcon from '~icons/heroicons/x-mark'

interface GraphPayload {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

interface ConceptSummary {
  id: string
  name: string
  description: string | null
  mentionCount: number
  topics: string[]
}

definePageMeta({
  middleware: ['auth', 'onboarding'],
  layout: 'default',
})

const { t } = useI18n()

const selectedConceptId = ref<string | null>(null)
const listOpen = ref(false)

const { data: graph } = await useFetch<GraphPayload>('/api/graph')

const { data: concepts } = await useFetch<ConceptSummary[]>('/api/graph/concepts')

const { data: detail } = useFetch<ConceptDetail>(() =>
  selectedConceptId.value ? `/api/graph/concepts/${selectedConceptId.value}` : null, {
  key: computed(() => `concept-${selectedConceptId.value ?? 'none'}`),
  watch: [selectedConceptId],
})

function selectConcept(conceptId: string) {
  selectedConceptId.value = conceptId
  listOpen.value = false
}

function handleNodeClick(node: GraphNode) {
  const action = resolveGraphNodeAction(node)
  if (action.type === 'select-concept') {
    selectedConceptId.value = action.conceptId
  }
  else if (action.type === 'navigate-note') {
    const query = action.syncedFolderId ? `?syncedFolder=${encodeURIComponent(action.syncedFolderId)}` : ''
    navigateTo(`/notes${action.path}${query}`)
  }
}

function openNote(path: string, syncedFolderId?: string) {
  const query = syncedFolderId ? `?syncedFolder=${encodeURIComponent(syncedFolderId)}` : ''
  navigateTo(`/notes${path}${query}`)
}
</script>

<template>
  <div class="h-[calc(100dvh-3.5rem)] flex flex-col">
    <div class="flex-1 flex overflow-hidden">
      <!-- Concept list -->
      <aside
        class="border-r border-gray-200 bg-white flex-col"
        :class="listOpen
          ? 'fixed inset-y-0 left-0 z-50 w-72 flex md:static'
          : 'hidden md:flex w-72'"
      >
        <h2 class="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
          {{ t('graph.concepts') }}
        </h2>
        <concept-list
          :concepts="concepts ?? []"
          :selected-concept-id="selectedConceptId"
          @select="selectConcept"
        />
      </aside>

      <!-- Mobile backdrop for the concept list drawer -->
      <div
        v-if="listOpen"
        class="fixed inset-0 z-40 bg-black/40 md:hidden"
        @click="listOpen = false"
      />

      <!-- Graph canvas -->
      <main class="flex-1 bg-gray-50 overflow-hidden relative">
        <button
          type="button"
          class="md:hidden absolute top-3 left-3 z-10 inline-flex items-center justify-center p-2 rounded-md bg-white shadow-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors"
          aria-label="Toggle concept list"
          @click="listOpen = !listOpen"
        >
          <QueueListIcon v-if="!listOpen" class="h-5 w-5" aria-hidden="true" />
          <XMarkIcon v-else class="h-5 w-5" aria-hidden="true" />
        </button>

        <ClientOnly>
          <graph-canvas
            v-if="graph && graph.nodes.length > 0"
            :nodes="graph.nodes"
            :edges="graph.edges"
            :selected-node-id="selectedConceptId"
            @select-node="handleNodeClick"
          />
          <div v-else class="h-full flex items-center justify-center text-gray-500">
            {{ t('graph.empty') }}
          </div>
          <template #fallback>
            <div class="h-full flex items-center justify-center text-gray-500">
              Loading graph...
            </div>
          </template>
        </ClientOnly>
      </main>

      <!-- Concept detail -->
      <aside
        class="border-l border-gray-200 bg-white flex-col"
        :class="selectedConceptId
          ? 'fixed inset-y-0 right-0 z-50 w-full max-w-sm flex md:static md:inset-auto md:w-80'
          : 'hidden md:flex w-80'"
      >
        <div
          v-if="selectedConceptId"
          class="md:hidden flex items-center justify-end px-3 py-2 border-b border-gray-200"
        >
          <button
            type="button"
            class="inline-flex items-center justify-center p-1.5 rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors"
            aria-label="Close concept details"
            @click="selectedConceptId = null"
          >
            <XMarkIcon class="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <concept-detail
          :detail="detail"
          @open-note="openNote"
        />
      </aside>
    </div>
  </div>
</template>
