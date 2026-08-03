<script setup lang="ts">
import type { GraphEdge, GraphNode, GraphRenderer } from '~/lib/graph-renderer/types'
import { useI18n } from 'vue-i18n'
import { createGraphRenderer } from '~/lib/graph-renderer'
import { resolveGraphRenderer } from '~/lib/graph-renderer/config'

const props = defineProps<{
  nodes: GraphNode[]
  edges: GraphEdge[]
  selectedNodeId: string | null
}>()

const emit = defineEmits<{
  (e: 'selectNode', node: GraphNode): void
  (e: 'error', message: string): void
}>()

const { t } = useI18n()

const containerRef = ref<HTMLDivElement | null>(null)
let renderer: GraphRenderer | null = null

// Read once at setup: the renderer is fixed per page load by runtime config
// (`NUXT_PUBLIC_GRAPH_RENDERER`), defaulting to the sigma (WebGL) renderer.
const graphRendererImpl = resolveGraphRenderer(useRuntimeConfig().public.graphRenderer)

const legendItems = computed(() => [
  { label: t('graph.legend.topic'), colorClass: 'bg-[#7c3aed]' },
  { label: t('graph.legend.concept'), colorClass: 'bg-[#4f46e5]' },
  { label: t('graph.legend.note'), colorClass: 'bg-[#059669]' },
  { label: t('graph.legend.tag'), colorClass: 'bg-[#d97706]' },
])

onMounted(async () => {
  if (!containerRef.value)
    return
  try {
    renderer = createGraphRenderer(graphRendererImpl)
    renderer.onNodeClick(node => emit('selectNode', node))
    await renderer.mount(containerRef.value)
    renderer.setGraph(props.nodes, props.edges)
    renderer.highlight(props.selectedNodeId)
  }
  catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Graph renderer init failed:', err)
    emit('error', message)
  }
})

onUnmounted(() => {
  renderer?.destroy()
  renderer = null
})

watch(() => [props.nodes, props.edges], () => {
  renderer?.setGraph(props.nodes, props.edges)
}, { deep: true })

watch(() => props.selectedNodeId, () => {
  renderer?.highlight(props.selectedNodeId)
})
</script>

<template>
  <div class="relative w-full h-full bg-gray-50">
    <div ref="containerRef" class="w-full h-full bg-gray-50" />
    <div
      data-testid="graph-legend"
      class="absolute top-3 right-3 bg-white/90 backdrop-blur-sm rounded-lg shadow-sm border border-gray-200 px-3 py-2 text-xs"
    >
      <ul class="space-y-1.5">
        <li v-for="item in legendItems" :key="item.label" class="flex items-center gap-2">
          <span class="h-2.5 w-2.5 rounded-full" :class="item.colorClass" />
          <span class="text-gray-600">{{ item.label }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>
