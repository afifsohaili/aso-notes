<script setup lang="ts">
import type { ConceptDetail, GraphEdge, GraphNode } from '~/server/lib/graph/ui'
import { useI18n } from 'vue-i18n'

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
  middleware: ['auth'],
  layout: 'default',
})

const { t } = useI18n()
const router = useRouter()

const selectedConceptId = ref<string | null>(null)

const { data: graph } = await useFetch<GraphPayload>('/api/graph')

const { data: concepts } = await useFetch<ConceptSummary[]>('/api/graph/concepts')

const { data: detail } = useFetch<ConceptDetail>(() =>
  selectedConceptId.value ? `/api/graph/concepts/${selectedConceptId.value}` : null, {
  key: computed(() => `concept-${selectedConceptId.value ?? 'none'}`),
  watch: [selectedConceptId],
})

function selectConcept(conceptId: string) {
  selectedConceptId.value = conceptId
}

function handleNodeClick(node: GraphNode) {
  if (node.label === 'Concept') {
    selectedConceptId.value = node.id
  }
  else if (node.label === 'Note') {
    router.push(`/notes`)
  }
}

function openNote(path: string) {
  router.push(`/notes?note=${encodeURIComponent(path)}`)
}
</script>

<template>
  <div class="h-[calc(100dvh-3.5rem)] flex flex-col">
    <div class="flex-1 flex overflow-hidden">
      <!-- Concept list -->
      <aside class="w-72 border-r border-gray-200 bg-white flex flex-col">
        <h2 class="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
          {{ t('graph.concepts') }}
        </h2>
        <concept-list
          :concepts="concepts ?? []"
          :selected-concept-id="selectedConceptId"
          @select="selectConcept"
        />
      </aside>

      <!-- Graph canvas -->
      <main class="flex-1 bg-gray-50 overflow-hidden relative">
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
      <aside class="w-80 border-l border-gray-200 bg-white flex flex-col">
        <concept-detail
          :detail="detail"
          @open-note="openNote"
        />
      </aside>
    </div>
  </div>
</template>
