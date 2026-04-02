import { assertEquals } from '@std/assert'

import { combineSections, parseSections } from './profiles.ts'

Deno.test('parseSections: parses capture section', () => {
  const content = '## Capture\nkeep api patterns\nkeep error handling'
  const result = parseSections(content)
  assertEquals(result.capture, ['keep api patterns', 'keep error handling'])
  assertEquals(result.skip, [])
})

Deno.test('parseSections: parses skip section', () => {
  const content = '## Skip\nskip temp files\nskip logs'
  const result = parseSections(content)
  assertEquals(result.capture, [])
  assertEquals(result.skip, ['skip temp files', 'skip logs'])
})

Deno.test('parseSections: parses both capture and skip', () => {
  const content = '## Capture\nitem-a\nitem-b\n\n## Skip\nitem-c'
  const result = parseSections(content)
  assertEquals(result.capture, ['item-a', 'item-b'])
  assertEquals(result.skip, ['item-c'])
})

Deno.test('parseSections: is case-insensitive for section headers', () => {
  const content = '## CAPTURE\nitem\n## SKIP\nother'
  const result = parseSections(content)
  assertEquals(result.capture, ['item'])
  assertEquals(result.skip, ['other'])
})

Deno.test('parseSections: stops collecting on unknown h2', () => {
  const content = '## Capture\nkeep this\n## Other Section\nignore this'
  const result = parseSections(content)
  assertEquals(result.capture, ['keep this'])
  assertEquals(result.skip, [])
})

Deno.test('parseSections: skips blank lines', () => {
  const content = '## Capture\n\nkeep this\n\n'
  const result = parseSections(content)
  assertEquals(result.capture, ['keep this'])
})

Deno.test('parseSections: returns empty for content with no sections', () => {
  const result = parseSections('just some text\nno sections here')
  assertEquals(result.capture, [])
  assertEquals(result.skip, [])
})

Deno.test('parseSections: returns empty for empty string', () => {
  const result = parseSections('')
  assertEquals(result.capture, [])
  assertEquals(result.skip, [])
})

Deno.test('combineSections: produces capture only', () => {
  const result = combineSections([{ capture: ['a', 'b'], skip: [] }])
  assertEquals(result, '## Capture\n\na\nb')
})

Deno.test('combineSections: produces skip only', () => {
  const result = combineSections([{ capture: [], skip: ['x'] }])
  assertEquals(result, '\n## Skip\n\nx')
})

Deno.test('combineSections: produces both sections', () => {
  const result = combineSections([{ capture: ['a'], skip: ['b'] }])
  assertEquals(result, '## Capture\n\na\n\n## Skip\n\nb')
})

Deno.test('combineSections: flattens multiple profiles', () => {
  const result = combineSections([
    { capture: ['a'], skip: ['x'] },
    { capture: ['b'], skip: ['y'] },
  ])
  assertEquals(result, '## Capture\n\na\nb\n\n## Skip\n\nx\ny')
})

Deno.test('combineSections: returns empty for empty input', () => {
  const result = combineSections([])
  assertEquals(result, '')
})

Deno.test('combineSections: returns empty for profiles with no content', () => {
  const result = combineSections([{ capture: [], skip: [] }])
  assertEquals(result, '')
})
