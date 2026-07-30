import { describe, expect, it } from 'vitest'
import { planOrphanGc } from '../../server/lib/sync/gc'

function c(id: string) {
  return { id }
}

function m(conceptId: string) {
  return { concept_id: conceptId }
}

function r(id: string, from: string, to: string) {
  return { id, from_concept_id: from, to_concept_id: to }
}

function ct(conceptId: string, topicId: string) {
  return { concept_id: conceptId, topic_id: topicId }
}

describe('planOrphanGc', () => {
  it('removes an exclusive concept and keeps a shared concept', () => {
    const plan = planOrphanGc({
      concepts: [c('exclusive'), c('shared')],
      mentions: [m('shared')],
      relations: [],
      conceptTopics: [],
    })

    expect(plan.conceptIdsToRemove).toEqual(['exclusive'])
    expect(plan.topicIdsToRemove).toEqual([])
  })

  it('removes relations that touch a dead concept, even when the other endpoint survives', () => {
    const plan = planOrphanGc({
      concepts: [c('dead'), c('alive')],
      mentions: [m('alive')],
      relations: [r('rel-1', 'dead', 'alive'), r('rel-2', 'alive', 'dead'), r('rel-3', 'alive', 'alive')],
      conceptTopics: [],
    })

    expect(plan.conceptIdsToRemove).toEqual(['dead'])
    expect(new Set(plan.relationIdsToRemove)).toEqual(new Set(['rel-1', 'rel-2']))
  })

  it('removes a relation when both endpoints are dead', () => {
    const plan = planOrphanGc({
      concepts: [c('a'), c('b')],
      mentions: [],
      relations: [r('rel', 'a', 'b')],
      conceptTopics: [],
    })

    expect(plan.conceptIdsToRemove).toEqual(['a', 'b'])
    expect(plan.relationIdsToRemove).toEqual(['rel'])
  })

  it('keeps a topic linked to a surviving concept even when some concepts die', () => {
    const plan = planOrphanGc({
      concepts: [c('dead-concept'), c('live-concept')],
      mentions: [m('live-concept')],
      relations: [],
      conceptTopics: [
        ct('dead-concept', 'shared-topic'),
        ct('live-concept', 'shared-topic'),
      ],
    })

    expect(plan.conceptIdsToRemove).toEqual(['dead-concept'])
    expect(plan.topicIdsToRemove).toEqual([])
  })

  it('removes a topic when all its linked concepts die', () => {
    const plan = planOrphanGc({
      concepts: [c('a'), c('b')],
      mentions: [],
      relations: [],
      conceptTopics: [
        ct('a', 'orphan-topic'),
        ct('b', 'orphan-topic'),
      ],
    })

    expect(plan.conceptIdsToRemove).toEqual(['a', 'b'])
    expect(plan.topicIdsToRemove).toEqual(['orphan-topic'])
  })

  it('keeps an unlinked topic when concepts in the same workspace still exist', () => {
    const plan = planOrphanGc({
      concepts: [c('mentioned')],
      mentions: [m('mentioned')],
      relations: [],
      conceptTopics: [
        ct('mentioned', 'live-topic'),
      ],
    })

    expect(plan.conceptIdsToRemove).toEqual([])
    expect(plan.topicIdsToRemove).toEqual([])
  })
})
