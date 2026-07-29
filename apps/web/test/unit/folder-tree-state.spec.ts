import { describe, expect, it } from 'vitest'
import { isFolderExpanded, toggleFolderExpanded } from '../../app/utils/folder-tree-state'

describe('folder-tree-state', () => {
  describe('isFolderExpanded', () => {
    it('defaults to collapsed when nothing is selected', () => {
      expect(isFolderExpanded({}, '/aso-notes', null)).toBe(false)
    })

    it('expands the selected folder by default', () => {
      expect(isFolderExpanded({}, '/aso-notes', '/aso-notes')).toBe(true)
    })

    it('expands ancestors of the selected path by default', () => {
      expect(isFolderExpanded({}, '/aso-notes', '/aso-notes/003-topics')).toBe(true)
      expect(isFolderExpanded({}, '/', '/aso-notes/003-topics')).toBe(true)
    })

    it('does not expand siblings or unrelated folders by default', () => {
      expect(isFolderExpanded({}, '/projexn', '/aso-notes/003-topics')).toBe(false)
      expect(isFolderExpanded({}, '/aso-notes/002-system', '/aso-notes/003-topics')).toBe(false)
    })

    it('does not treat same-prefix folder names as ancestors', () => {
      expect(isFolderExpanded({}, '/aso', '/aso-notes/x')).toBe(false)
    })

    it('honours explicit overrides over the ancestor default', () => {
      expect(isFolderExpanded({ '/aso-notes': false }, '/aso-notes', '/aso-notes/003')).toBe(false)
      expect(isFolderExpanded({ '/projexn': true }, '/projexn', '/aso-notes/003')).toBe(true)
    })
  })

  describe('toggleFolderExpanded', () => {
    it('expands a collapsed folder', () => {
      const next = toggleFolderExpanded({}, '/projexn', null)
      expect(isFolderExpanded(next, '/projexn', null)).toBe(true)
    })

    it('collapses an expanded folder', () => {
      const next = toggleFolderExpanded({ '/projexn': true }, '/projexn', null)
      expect(isFolderExpanded(next, '/projexn', null)).toBe(false)
    })

    it('collapses a default-expanded ancestor explicitly', () => {
      const next = toggleFolderExpanded({}, '/aso-notes', '/aso-notes/003')
      expect(isFolderExpanded(next, '/aso-notes', '/aso-notes/003')).toBe(false)
    })

    it('re-expands an explicitly collapsed ancestor', () => {
      const collapsed = toggleFolderExpanded({}, '/aso-notes', '/aso-notes/003')
      const reopened = toggleFolderExpanded(collapsed, '/aso-notes', '/aso-notes/003')
      expect(isFolderExpanded(reopened, '/aso-notes', '/aso-notes/003')).toBe(true)
    })

    it('does not mutate the input state', () => {
      const state = { '/a': true }
      toggleFolderExpanded(state, '/b', null)
      expect(state).toEqual({ '/a': true })
    })
  })
})
