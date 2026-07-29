import type { VocabularyStrategy } from './types'
import { blindMergeStrategy } from './blind-merge'
import { fullVocabularyStrategy } from './full'
import { topKStrategy } from './top-k'

const registry = new Map<string, VocabularyStrategy>([
  [fullVocabularyStrategy.id, fullVocabularyStrategy],
  [topKStrategy().id, topKStrategy()],
  [blindMergeStrategy.id, blindMergeStrategy],
])

/** Register a vocabulary strategy. Overwrites an existing id. */
export function registerVocabularyStrategy(strategy: VocabularyStrategy): void {
  registry.set(strategy.id, strategy)
}

/** Look up a registered vocabulary strategy by id. */
export function getVocabularyStrategy(id: string): VocabularyStrategy {
  const strategy = registry.get(id)
  if (!strategy)
    throw new Error(`unknown vocabulary strategy: '${id}'`)
  return strategy
}

/** The code default vocabulary strategy. */
export function defaultVocabularyStrategy(): VocabularyStrategy {
  return topKStrategy()
}

export { blindMergeStrategy, fullVocabularyStrategy, topKStrategy }
export type { Vocabulary, VocabularyStrategy } from './types'
