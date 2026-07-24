import { describe, expect, it } from 'vitest'
import { parseNoteLinks } from '../../server/lib/pipeline/links'

describe('parseNoteLinks', () => {
  it('parses wikilinks, keeping the target as raw_target', () => {
    const links = parseNoteLinks('see [[Graph RAG]] and [[/proj/setup.md]]', '/notes/a.md')
    expect(links.map(l => l.rawTarget)).toEqual(['Graph RAG', '/proj/setup.md'])
  })

  it('strips wikilink aliases and heading refs from the target', () => {
    const links = parseNoteLinks('[[Graph RAG|the graph thing]] and [[setup#step 2]]', '/a.md')
    expect(links.map(l => l.rawTarget)).toEqual(['Graph RAG', 'setup'])
  })

  it('resolves absolute wikilink targets against the root, appending .md when extensionless', () => {
    const [abs, extless] = parseNoteLinks('[[/proj/b.md]] [[/proj/b]]', '/notes/a.md')
    expect(abs!.candidates).toEqual(['/proj/b.md'])
    expect(extless!.candidates).toEqual(['/proj/b', '/proj/b.md'])
  })

  it('resolves bare targets relative to the note folder first, then root', () => {
    const [link] = parseNoteLinks('[[sibling]]', '/proj/deep/a.md')
    expect(link!.candidates).toEqual([
      '/proj/deep/sibling',
      '/proj/deep/sibling.md',
      '/sibling',
      '/sibling.md',
    ])
  })

  it('parses internal markdown links relative to the note folder', () => {
    const links = parseNoteLinks('read [the spec](./spec.md) and [up](../other.md)', '/proj/a.md')
    expect(links.map(l => l.rawTarget)).toEqual(['./spec.md', '../other.md'])
    expect(links[0]!.candidates[0]).toBe('/proj/spec.md')
    expect(links[1]!.candidates[0]).toBe('/other.md')
  })

  it('ignores external URLs, anchors, mailto links, and images', () => {
    const content = [
      '[web](https://example.com/x)',
      '[yt](https://youtu.be/abc)',
      '[mail](mailto:a@b.c)',
      '[anchor](#section)',
      '![img](./picture.png)',
      '[proto](ftp://x)',
    ].join('\n')
    expect(parseNoteLinks(content, '/a.md')).toEqual([])
  })

  it('does not treat wikilinks as markdown links', () => {
    const links = parseNoteLinks('[[Graph RAG|alias]]', '/a.md')
    expect(links).toHaveLength(1)
    expect(links[0]!.rawTarget).toBe('Graph RAG')
  })

  it('dedupes repeated targets, keeping first occurrence order', () => {
    const links = parseNoteLinks('[[A]] then [[A|again]] then [a](./a)', '/a.md')
    // [[A]] and [a](./a) resolve to different candidate sets — both kept
    expect(links.map(l => l.rawTarget)).toEqual(['A', './a'])
  })

  it('skips empty wikilinks', () => {
    expect(parseNoteLinks('[[ ]] and [[]]', '/a.md')).toEqual([])
  })

  it('returns nothing for content without links', () => {
    expect(parseNoteLinks('plain text, no links', '/a.md')).toEqual([])
  })
})
