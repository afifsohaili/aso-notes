export interface GroupableConcept {
  id: string
  name: string
  description: string | null
  mentionCount: number
  topics: string[] | undefined
}

export interface TopicGroup {
  topic: string | null
  concepts: GroupableConcept[]
}

export type GraphNodeAction
  = { type: 'select-concept', conceptId: string }
    | { type: 'navigate-note', path: string }
    | { type: 'noop' }

export function resolveGraphNodeAction(node: { id: string, label: 'Concept' | 'Note' | 'Tag' | 'Topic', name: string, ref: string }): GraphNodeAction {
  switch (node.label) {
    case 'Concept':
      return { type: 'select-concept', conceptId: node.id }
    case 'Note': {
      const path = node.ref.startsWith('/') ? node.ref : `/${node.ref}`
      return { type: 'navigate-note', path }
    }
    default:
      return { type: 'noop' }
  }
}

export function groupConceptsByTopic(concepts: GroupableConcept[]): TopicGroup[] {
  const byTopic = new Map<string, GroupableConcept[]>()
  const ungrouped: GroupableConcept[] = []

  for (const concept of concepts) {
    const conceptTopics = concept.topics ?? []
    if (conceptTopics.length === 0) {
      ungrouped.push(concept)
      continue
    }
    for (const topic of conceptTopics) {
      let list = byTopic.get(topic)
      if (!list) {
        list = []
        byTopic.set(topic, list)
      }
      list.push(concept)
    }
  }

  const groups: TopicGroup[] = Array.from(byTopic.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([topic, concepts]) => ({ topic, concepts }))

  if (ungrouped.length > 0) {
    groups.push({ topic: null, concepts: ungrouped })
  }

  return groups
}
