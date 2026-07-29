import { describe, expect, it } from 'vitest'
import { resolveGraphNodeAction } from '../../app/utils/graph'

describe('resolveGraphNodeAction', () => {
  it('selects a concept by id', () => {
    const action = resolveGraphNodeAction({ id: 'c1', label: 'Concept', name: 'Graph RAG', ref: 'c1' })
    expect(action).toEqual({ type: 'select-concept', conceptId: 'c1' })
  })

  it('navigates to a note using its path ref', () => {
    const action = resolveGraphNodeAction({ id: 'n1', label: 'Note', name: 'Plan', ref: '/project-a/plan.md' })
    expect(action).toEqual({ type: 'navigate-note', path: '/project-a/plan.md' })
  })

  it('roots note paths that lack a leading slash', () => {
    const action = resolveGraphNodeAction({ id: 'n1', label: 'Note', name: 'Plan', ref: 'project-a/plan.md' })
    expect(action).toEqual({ type: 'navigate-note', path: '/project-a/plan.md' })
  })

  it('does nothing for topic and tag nodes', () => {
    expect(resolveGraphNodeAction({ id: 't1', label: 'Topic', name: 'Engineering', ref: 't1' }))
      .toEqual({ type: 'noop' })
    expect(resolveGraphNodeAction({ id: 'g1', label: 'Tag', name: 'important', ref: 'g1' }))
      .toEqual({ type: 'noop' })
  })
})
