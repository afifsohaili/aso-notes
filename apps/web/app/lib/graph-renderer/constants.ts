import type { GraphNode } from './types'

/**
 * Node colors must match the legend rendered by `graph-canvas.vue`.
 */
export const NODE_COLORS: Record<GraphNode['label'], string> = {
  Concept: '#4f46e5',
  Topic: '#7c3aed',
  Note: '#059669',
  Tag: '#d97706',
}

/**
 * Node sizes (px radius in sigma) — Topic > Concept > Note > Tag.
 */
export const NODE_SIZES: Record<GraphNode['label'], number> = {
  Topic: 12,
  Concept: 8,
  Note: 6,
  Tag: 5,
}

/** Muted edge styling, close to the cytoscape renderer's edge color. */
export const EDGE_COLOR = '#94a3b8'
export const EDGE_SIZE = 1.5

/**
 * Labels render only once a node is big enough on screen. This is an
 * intentional improvement over the cytoscape renderer (labels always on):
 * the overview stays uncluttered and labels fade in when zoomed.
 */
export const LABEL_RENDERED_SIZE_THRESHOLD = 8

/**
 * Bounded synchronous FA2 run — the ego-graph overview is a few hundred
 * nodes at most, so a main-thread assign is acceptable.
 */
export const FA2_ITERATIONS = 150
