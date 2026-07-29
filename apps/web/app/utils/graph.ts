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
