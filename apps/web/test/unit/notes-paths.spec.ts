import { describe, expect, it } from 'vitest'
import { parseNoteRoutePath } from '../../server/lib/notes/paths'

describe('parseNoteRoutePath', () => {
  it('normalizes a relative URL path to a workspace-relative note path', () => {
    expect(parseNoteRoutePath('project-a/plan.md')).toBe('/project-a/plan.md')
  })

  it('rejects paths containing ..', () => {
    expect(() => parseNoteRoutePath('project-a/../plan.md')).toThrow('traversal')
  })

  it('rejects absolute paths', () => {
    expect(() => parseNoteRoutePath('/etc/passwd')).toThrow('absolute')
  })

  it('accepts a root-level note path', () => {
    expect(parseNoteRoutePath('inbox.md')).toBe('/inbox.md')
  })

  it('rejects URL-encoded absolute paths', () => {
    // A leading slash decoded from an encoded URL component is still absolute.
    expect(() => parseNoteRoutePath('/etc/passwd')).toThrow('absolute')
  })
})
