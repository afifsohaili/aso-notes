<script setup lang="ts">
import type { ConceptDetail, GraphEdge, GraphNode } from '~/server/lib/graph/ui'
import { useI18n } from 'vue-i18n'
import { mergeGraphEdges, mergeGraphNodes } from '~/lib/graph-renderer/merge'

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

const { data: graph } = await useFetch<GraphPayload>('/api/graph')

const { data: concepts } = await useFetch<ConceptSummary[]>('/api/graph/concepts')

const { data: detail } = useFetch<ConceptDetail>(() =>
  selectedConceptId.value ? `/api/graph/concepts/${selectedConceptId.value}` : null, {
  key: computed(() => `concept-${selectedConceptId.value ?? 'none'}`),
  watch: [selectedConceptId],
})

// Drill-down state (Phase 4): the overview loads once; clicking a Topic or
// Concept fetches its 1-hop ego graph and merges it in place (deduped).
const nodes = ref<GraphNode[]>(graph.value?.nodes ?? [])
const edges = ref<GraphEdge[]>(graph.value?.edges ?? [])
const expandedNodeIds = ref<Set<string>>(new Set())
const inflightNodeIds = new Set<string>()
const drilldownError = ref<string | null>(null)

function dismissDrilldownError() {
  drilldownError.value = null
}

async function expandNode(node: GraphNode) {
  if (expandedNodeIds.value.has(node.id) || inflightNodeIds.has(node.id))
    return
  inflightNodeIds.add(node.id)
  try {
    const payload = await $fetch<GraphPayload>(`/api/graph/neighborhood?node=${encodeURIComponent(node.id)}&depth=1`)
    nodes.value = mergeGraphNodes(nodes.value, payload.nodes)
    edges.value = mergeGraphEdges(edges.value, payload.edges)
    expandedNodeIds.value = new Set(expandedNodeIds.value).add(node.id)
  }
  catch (err) {
    console.error(`Failed to expand graph node ${node.id}:`, err)
    drilldownError.value = err instanceof Error ? err.message : String(err)
  }
  finally {
    inflightNodeIds.delete(node.id)
  }
}

function selectConcept(conceptId: string) {
  selectedConceptId.value = conceptId
}

function handleNodeClick(node: GraphNode) {
  if (node.label === 'Concept' || node.label === 'Topic')
    expandNode(node)
  const action = resolveGraphNodeAction(node)
  if (action.type === 'select-concept') {
    selectedConceptId.value = action.conceptId
  }
  else if (action.type === 'navigate-note') {
    navigateTo(`/notes${action.path}`)
  }
}

function openNote(path: string) {
  navigateTo(`/notes${path}`)
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
        <div
          v-if="drilldownError"
          data-testid="graph-error"
          role="alert"
          class="absolute top-3 left-3 z-10 flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-md px-3 py-2 shadow-sm"
        >
          <span>{{ drilldownError }}</span>
          <button
            type="button"
            data-testid="graph-error-dismiss"
            class="text-red-500 hover:text-red-700 font-semibold"
            :aria-label="t('graph.dismissError')"
            @click="dismissDrilldownError"
          >
            ×
          </button>
        </div>
        <ClientOnly>
          <graph-canvas
            v-if="graph && graph.nodes.length > 0"
            :nodes="nodes"
            :edges="edges"
            :selected-node-id="selectedConceptId"
            @select-node="handleNodeClick"
            @error="drilldownError = $event"
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
