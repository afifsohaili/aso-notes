/**
 * Note route-path helpers. Workspace-relative note paths are canonical POSIX
 * strings with a leading slash (e.g. `/project-a/plan.md`). URL route params
 * are relative strings (e.g. `project-a/plan.md`). These helpers safely
 * convert the route form to the canonical form and reject traversal.
 */

export class NotePathError extends Error {
  statusCode = 400
  constructor(message: string) {
    super(message)
    this.name = 'NotePathError'
  }
}

export function parseNoteRoutePath(rawPath: string): string {
  if (rawPath.includes('..')) {
    throw new NotePathError('Invalid path: traversal not allowed')
  }
  if (rawPath.startsWith('/')) {
    throw new NotePathError('Invalid path: absolute paths not allowed')
  }
  return `/${rawPath}`
}

/** Extract the canonical note path from a route slug array. */
export function parseNoteRouteSegments(segments: string[]): string {
  return parseNoteRoutePath(segments.join('/'))
}

/** True when the slug segments target the tags collection of a note path. */
export function isTagsRoute(segments: string[]): boolean {
  return segments.length > 0 && segments[segments.length - 1] === 'tags'
}

/** True when the slug segments target a specific tag on a note path. */
export function isTagDeleteRoute(segments: string[]): boolean {
  return (
    segments.length >= 3
    && segments[segments.length - 2] === 'tags'
  )
}

/** Extract note-path segments and tag id from a tag-delete route. */
export function parseTagDeleteRoute(segments: string[]): { notePath: string, tagId: string } {
  const tagId = segments[segments.length - 1]!
  const noteSegments = segments.slice(0, -2)
  return { notePath: parseNoteRouteSegments(noteSegments), tagId }
}

/** Extract note-path segments from a tags-collection route. */
export function parseTagsRoute(segments: string[]): string {
  return parseNoteRouteSegments(segments.slice(0, -1))
}
