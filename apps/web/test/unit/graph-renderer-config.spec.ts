import { describe, expect, it } from 'vitest'
import { resolveGraphRenderer } from '../../app/lib/graph-renderer/config'

describe('resolveGraphRenderer', () => {
  it('keeps a valid sigma value', () => {
    expect(resolveGraphRenderer('sigma')).toBe('sigma')
  })

  it('keeps a valid cytoscape value', () => {
    expect(resolveGraphRenderer('cytoscape')).toBe('cytoscape')
  })

  it('falls back to sigma for unknown values', () => {
    expect(resolveGraphRenderer('paperjs')).toBe('sigma')
  })

  it('falls back to sigma when unset', () => {
    expect(resolveGraphRenderer(undefined)).toBe('sigma')
    expect(resolveGraphRenderer(null)).toBe('sigma')
  })

  it('falls back to sigma for non-string values', () => {
    expect(resolveGraphRenderer(42)).toBe('sigma')
    expect(resolveGraphRenderer({ impl: 'sigma' })).toBe('sigma')
  })
})
