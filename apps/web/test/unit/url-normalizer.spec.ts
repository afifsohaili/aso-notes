import { describe, expect, it } from 'vitest'
import { deriveSourceType, normalizeUrl } from '../../server/lib/pipeline/url-normalizer'

describe('normalizeUrl', () => {
  const cases: [string, string, string | null][] = [
    // [name, input, expected]
    ['lowercases scheme and host', 'HTTPS://Example.COM/Path', 'example.com/Path'],
    ['strips www.', 'https://www.example.com/a', 'example.com/a'],
    ['strips fragment', 'https://example.com/a#section', 'example.com/a'],
    ['strips trailing slash', 'https://example.com/a/', 'example.com/a'],
    ['keeps root path empty', 'https://example.com/', 'example.com'],
    ['strips query params on generic hosts', 'https://example.com/a?utm_source=x&id=1', 'example.com/a'],
    ['strips all query params at root', 'https://example.com/?ref=home', 'example.com'],
    ['youtube keeps v param, strips t and others', 'https://www.youtube.com/watch?v=abc123&t=42s&list=PL1', 'youtube.com/watch?v=abc123'],
    ['youtube keeps only v even when reordered', 'https://youtube.com/watch?feature=share&v=xyz', 'youtube.com/watch?v=xyz'],
    ['youtube watch without v strips query', 'https://youtube.com/watch?t=10', 'youtube.com/watch'],
    ['rewrites youtu.be short links', 'https://youtu.be/abc123', 'youtube.com/watch?v=abc123'],
    ['youtu.be strips extra params but keeps id', 'https://youtu.be/abc123?t=42', 'youtube.com/watch?v=abc123'],
    ['tiktok strips tracking params', 'https://www.tiktok.com/@user/video/123?lang=en', 'tiktok.com/@user/video/123'],
    ['returns null for unparseable input', 'not a url', null],
    ['returns null for non-http schemes', 'ftp://example.com/a', null],
  ]

  it.each(cases)('%s', (_name, input, expected) => {
    expect(normalizeUrl(input)).toBe(expected)
  })
})

describe('deriveSourceType', () => {
  const cases: [string, string][] = [
    ['https://www.youtube.com/watch?v=abc', 'youtube'],
    ['https://youtu.be/abc', 'youtube'],
    ['https://m.youtube.com/watch?v=abc', 'youtube'],
    ['https://www.tiktok.com/@user/video/123', 'tiktok'],
    ['https://example.com/article', 'web'],
    ['https://blog.example.org/post', 'web'],
  ]

  it.each(cases)('%s → %s', (url, expected) => {
    expect(deriveSourceType(url)).toBe(expected)
  })
})
