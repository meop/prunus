import { assertEquals, assertNotEquals } from '@std/assert'

import {
  buildNoteContent,
  contentHash,
  emptyFrontmatter,
  extractWikilinks,
  parseFrontmatter,
  serializeFrontmatter,
} from './parser.ts'

Deno.test('parseFrontmatter: parses valid frontmatter', () => {
  const content = `---
id: abc-123
summary: "A test note"
created: 2025-01-01T00:00:00.000Z
updated: 2025-01-02T00:00:00.000Z
projects:
  - proj-a
  - proj-b
tags:
  - tag1
  - tag2
---

Some body text here.`

  const { frontmatter: fm, body } = parseFrontmatter(content)
  assertEquals(fm.id, 'abc-123')
  assertEquals(fm.summary, 'A test note')
  assertEquals(fm.created, '2025-01-01T00:00:00.000Z')
  assertEquals(fm.updated, '2025-01-02T00:00:00.000Z')
  assertEquals(fm.projects, ['proj-a', 'proj-b'])
  assertEquals(fm.tags, ['tag1', 'tag2'])
  assertEquals(body, '\nSome body text here.')
})

Deno.test('parseFrontmatter: returns empty frontmatter for content without it', () => {
  const content = 'Just some markdown\nwith no frontmatter'
  const { frontmatter: fm, body } = parseFrontmatter(content)
  assertNotEquals(fm.id, '')
  assertEquals(fm.summary, '')
  assertEquals(fm.projects, [])
  assertEquals(fm.tags, [])
  assertEquals(body, content)
})

Deno.test('parseFrontmatter: handles empty body after frontmatter', () => {
  const content = `---
id: x
summary: "s"
created: "2025-01-01T00:00:00.000Z"
updated: "2025-01-01T00:00:00.000Z"
projects:
tags:
---`
  const { frontmatter: fm, body } = parseFrontmatter(content)
  assertEquals(fm.id, 'x')
  assertEquals(fm.summary, 's')
  assertEquals(body, '')
})

Deno.test('parseFrontmatter: handles single-quoted summary', () => {
  const content = `---
id: abc
summary: 'single quoted'
created: "2025-01-01T00:00:00.000Z"
updated: "2025-01-01T00:00:00.000Z"
projects:
tags:
---

body`
  const { frontmatter: fm } = parseFrontmatter(content)
  assertEquals(fm.summary, 'single quoted')
})

Deno.test('parseFrontmatter: handles unquoted summary', () => {
  const content = `---
id: abc
summary: plain text summary
created: "2025-01-01T00:00:00.000Z"
updated: "2025-01-01T00:00:00.000Z"
projects:
tags:
---

body`
  const { frontmatter: fm } = parseFrontmatter(content)
  assertEquals(fm.summary, 'plain text summary')
})

Deno.test('parseFrontmatter: ignores unknown keys', () => {
  const content = `---
id: abc
summary: "s"
created: "2025-01-01T00:00:00.000Z"
updated: "2025-01-01T00:00:00.000Z"
projects:
tags:
unknown_key: value
---

body`
  const { frontmatter: fm } = parseFrontmatter(content)
  assertEquals(fm.id, 'abc')
})

Deno.test('emptyFrontmatter: generates valid defaults', () => {
  const fm = emptyFrontmatter()
  assertNotEquals(fm.id, '')
  assertEquals(fm.summary, '')
  assertEquals(fm.projects, [])
  assertEquals(fm.tags, [])
  assertEquals(fm.created, fm.updated)
})

Deno.test('serializeFrontmatter: round-trips through parse', () => {
  const original = {
    id: 'test-id',
    summary: 'test summary',
    created: '2025-01-01T00:00:00.000Z',
    updated: '2025-06-15T12:00:00.000Z',
    projects: ['p1', 'p2'],
    tags: ['t1'],
  }
  const serialized = serializeFrontmatter(original)
  const { frontmatter: fm } = parseFrontmatter(serialized + 'body content')
  assertEquals(fm.id, original.id)
  assertEquals(fm.summary, original.summary)
  assertEquals(fm.created, original.created)
  assertEquals(fm.updated, original.updated)
  assertEquals(fm.projects, original.projects)
  assertEquals(fm.tags, original.tags)
})

Deno.test('serializeFrontmatter: handles empty lists', () => {
  const fm = {
    id: 'id1',
    summary: '',
    created: '2025-01-01T00:00:00.000Z',
    updated: '2025-01-01T00:00:00.000Z',
    projects: [],
    tags: [],
  }
  const serialized = serializeFrontmatter(fm)
  const { frontmatter: parsed } = parseFrontmatter(serialized + 'body')
  assertEquals(parsed.projects, [])
  assertEquals(parsed.tags, [])
})

Deno.test('buildNoteContent: concatenates frontmatter and body', () => {
  const fm = {
    id: 'x',
    summary: 'sum',
    created: '2025-01-01T00:00:00.000Z',
    updated: '2025-01-01T00:00:00.000Z',
    projects: [],
    tags: [],
  }
  const result = buildNoteContent(fm, 'hello world')
  assertEquals(result, serializeFrontmatter(fm) + 'hello world')
})

Deno.test('extractWikilinks: extracts basic wikilinks', () => {
  const body = 'See [[my-note]] and [[another/note]] for details.'
  assertEquals(extractWikilinks(body), ['my-note', 'another/note'])
})

Deno.test('extractWikilinks: deduplicates links', () => {
  const body = '[[foo]] and [[foo]] again'
  assertEquals(extractWikilinks(body), ['foo'])
})

Deno.test('extractWikilinks: handles link with heading fragment', () => {
  const body = '[[some-note#section]]'
  assertEquals(extractWikilinks(body), ['some-note'])
})

Deno.test('extractWikilinks: handles link with alias', () => {
  const body = '[[real-target|display text]]'
  assertEquals(extractWikilinks(body), ['real-target'])
})

Deno.test('extractWikilinks: handles heading and alias combined', () => {
  const body = '[[target#heading|alias]]'
  assertEquals(extractWikilinks(body), ['target'])
})

Deno.test('extractWikilinks: returns empty for no links', () => {
  assertEquals(extractWikilinks('plain text'), [])
  assertEquals(extractWikilinks(''), [])
})

Deno.test('contentHash: deterministic', () => {
  const h1 = contentHash('summary', 'body')
  const h2 = contentHash('summary', 'body')
  assertEquals(h1, h2)
})

Deno.test('contentHash: different content gives different hash', () => {
  const h1 = contentHash('summary1', 'body')
  const h2 = contentHash('summary2', 'body')
  assertNotEquals(h1, h2)
})

Deno.test('contentHash: returns 8-char hex string', () => {
  const h = contentHash('a', 'b')
  assertEquals(h.length, 8)
  assertEquals(/^[0-9a-f]{8}$/.test(h), true)
})
