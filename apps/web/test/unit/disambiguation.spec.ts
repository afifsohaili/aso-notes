import { describe, expect, it } from 'vitest'
import { computePathPrefixes } from '../../server/lib/notes/disambiguation'

const root = (id: string, path: string, alias: string | null = null) => ({ id, path, alias })

describe('computePathPrefixes', () => {
  it('returns null for every root when basenames do not collide', () => {
    const map = computePathPrefixes([
      root('a', '/tmp/justjom/plans'),
      root('b', '/tmp/cntctus/ideas'),
    ])
    expect(map.get('a')).toBeNull()
    expect(map.get('b')).toBeNull()
  })

  it('returns the immediate parent segment for a one-segment collision', () => {
    const map = computePathPrefixes([
      root('a', '/tmp/justjom/plans'),
      root('b', '/tmp/cntctus/plans'),
    ])
    expect(map.get('a')).toBe('justjom/')
    expect(map.get('b')).toBe('cntctus/')
  })

  it('walks up until the parent segments are unique for a deeper collision', () => {
    const map = computePathPrefixes([
      root('a', '/tmp/a/x/plans'),
      root('b', '/tmp/b/x/plans'),
    ])
    expect(map.get('a')).toBe('a/x/')
    expect(map.get('b')).toBe('b/x/')
  })

  it('excludes roots with an alias set from the collision set', () => {
    const map = computePathPrefixes([
      root('a', '/tmp/justjom/plans'),
      root('b', '/tmp/cntctus/plans'),
      root('c', '/tmp/work/plans', 'Work Plans'),
    ])
    // c has an alias: never gets a prefix
    expect(map.get('c')).toBeNull()
    // a and b still collide with each other
    expect(map.get('a')).toBe('justjom/')
    expect(map.get('b')).toBe('cntctus/')
  })

  it('resolves a three-way collision to three distinct prefixes', () => {
    const map = computePathPrefixes([
      root('a', '/tmp/one/plans'),
      root('b', '/tmp/two/plans'),
      root('c', '/tmp/three/plans'),
    ])
    expect(map.get('a')).toBe('one/')
    expect(map.get('b')).toBe('two/')
    expect(map.get('c')).toBe('three/')
  })

  it('returns null when only one root in a basename group lacks an alias', () => {
    const map = computePathPrefixes([
      root('a', '/tmp/justjom/plans', 'Justjom Plans'),
      root('b', '/tmp/cntctus/plans'),
    ])
    expect(map.get('a')).toBeNull()
    expect(map.get('b')).toBeNull()
  })
})
