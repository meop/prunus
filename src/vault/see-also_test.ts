import { assertEquals } from '@std/assert'

import { addSeeAlsoLink, getSeeAlsoLinks, removeSeeAlsoLink } from './see-also.ts'

Deno.test('getSeeAlsoLinks: returns empty for body without section', () => {
  assertEquals(getSeeAlsoLinks('some text'), [])
})

Deno.test('getSeeAlsoLinks: extracts links from See Also section', () => {
  const body = 'Main content\n\n## See also\n\n- [[note-a]]\n- [[note-b]]\n'
  assertEquals(getSeeAlsoLinks(body), ['note-a', 'note-b'])
})

Deno.test('getSeeAlsoLinks: returns empty when section has no links', () => {
  const body = 'Main content\n\n## See also\n\n'
  assertEquals(getSeeAlsoLinks(body), [])
})

Deno.test('addSeeAlsoLink: adds first link to body without section', () => {
  const result = addSeeAlsoLink('main content', 'new-link')
  assertEquals(result, 'main content\n\n## See also\n\n- [[new-link]]\n')
})

Deno.test('addSeeAlsoLink: appends to existing section', () => {
  const body = 'main\n\n## See also\n\n- [[existing]]\n'
  const result = addSeeAlsoLink(body, 'new-link')
  assertEquals(result, 'main\n\n## See also\n\n- [[existing]]\n- [[new-link]]\n')
})

Deno.test('addSeeAlsoLink: no-op when link already present', () => {
  const body = 'main\n\n## See also\n\n- [[existing]]\n'
  const result = addSeeAlsoLink(body, 'existing')
  assertEquals(result, body)
})

Deno.test('removeSeeAlsoLink: removes a link from section', () => {
  const body = 'main\n\n## See also\n\n- [[a]]\n- [[b]]\n- [[c]]\n'
  const result = removeSeeAlsoLink(body, 'b')
  assertEquals(result, 'main\n\n## See also\n\n- [[a]]\n- [[c]]\n')
})

Deno.test('removeSeeAlsoLink: removes last link and collapses section', () => {
  const body = 'main\n\n## See also\n\n- [[only-one]]\n'
  const result = removeSeeAlsoLink(body, 'only-one')
  assertEquals(result, 'main')
})

Deno.test('removeSeeAlsoLink: no-op when link not found', () => {
  const body = 'main\n\n## See also\n\n- [[a]]\n'
  const result = removeSeeAlsoLink(body, 'missing')
  assertEquals(result, body)
})

Deno.test('removeSeeAlsoLink: no-op on body without section', () => {
  const body = 'just content'
  const result = removeSeeAlsoLink(body, 'anything')
  assertEquals(result, body)
})
