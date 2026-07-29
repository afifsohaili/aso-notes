import { describe, expect, it } from 'vitest'
import { parseNoteRoutePath, resolveNotesRoutePath } from '../../server/lib/notes/paths'

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

describe('resolveNotesRoutePath', () => {
  it('resolves a known note path', () => {
    expect(resolveNotesRoutePath('project-a/plan.md', ['/project-a'], ['/project-a/plan.md'])).toBe('note')
  })

  it('resolves a known folder path', () => {
    expect(resolveNotesRoutePath('project-a', ['/project-a'], ['/project-a/plan.md'])).toBe('folder')
  })

  it('returns not_found for unknown paths', () => {
    expect(resolveNotesRoutePath('unknown', ['/project-a'], ['/project-a/plan.md'])).toBe('not_found')
  })

  it('ignores trailing slashes on folder paths', () => {
    expect(resolveNotesRoutePath('project-a/', ['/project-a'], [])).toBe('folder')
  })

  it('ignores trailing slashes on note paths', () => {
    expect(resolveNotesRoutePath('project-a/plan.md/', ['/project-a'], ['/project-a/plan.md'])).toBe('note')
  })

  it('resolves paths with encoded characters', () => {
    expect(resolveNotesRoutePath('foo bar/baz.md', ['/foo bar'], ['/foo bar/baz.md'])).toBe('note')
  })

  it('resolves root-level notes', () => {
    expect(resolveNotesRoutePath('inbox.md', [], ['/inbox.md'])).toBe('note')
  })

  it('returns not_found for a path that looks like a note but is not known', () => {
    expect(resolveNotesRoutePath('project-a/missing.md', ['/project-a'], ['/project-a/plan.md'])).toBe('not_found')
  })

  it('returns not_found when a parent path is not an explicit folder', () => {
    expect(resolveNotesRoutePath('project-a/sub/plan.md', ['/project-a'], ['/project-a/plan.md'])).toBe('not_found')
  })
})
