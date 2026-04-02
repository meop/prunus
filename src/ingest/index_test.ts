import { assertEquals } from '@std/assert'

import { parseChunks } from './index.ts'

Deno.test('parseChunks: parses valid JSON array', () => {
  const text = 'Some text [{"topic": "test topic", "excerpt": "some detail"}] more text'
  const result = parseChunks(text)
  assertEquals(result, [{ topic: 'test topic', excerpt: 'some detail' }])
})

Deno.test('parseChunks: parses multiple chunks', () => {
  const text = '[{"topic": "a", "excerpt": "x"}, {"topic": "b", "excerpt": "y"}]'
  const result = parseChunks(text)
  assertEquals(result, [
    { topic: 'a', excerpt: 'x' },
    { topic: 'b', excerpt: 'y' },
  ])
})

Deno.test('parseChunks: filters out invalid entries', () => {
  const text = '[{"topic": "valid", "excerpt": "yes"}, {"topic": 123}, "string", null]'
  const result = parseChunks(text)
  assertEquals(result, [{ topic: 'valid', excerpt: 'yes' }])
})

Deno.test('parseChunks: returns empty for no JSON array', () => {
  assertEquals(parseChunks('no json here'), [])
})

Deno.test('parseChunks: returns empty for empty string', () => {
  assertEquals(parseChunks(''), [])
})

Deno.test('parseChunks: returns empty for non-array JSON', () => {
  assertEquals(parseChunks('{"key": "value"}'), [])
})

Deno.test('parseChunks: handles JSON with surrounding markdown', () => {
  const text = '```json\n[{"topic": "t", "excerpt": "e"}]\n```'
  const result = parseChunks(text)
  assertEquals(result, [{ topic: 't', excerpt: 'e' }])
})

Deno.test('parseChunks: returns empty for empty array', () => {
  assertEquals(parseChunks('[]'), [])
})

Deno.test('parseChunks: handles entries with missing fields', () => {
  const text = '[{"topic": "has topic"}, {"excerpt": "has excerpt only"}]'
  const result = parseChunks(text)
  assertEquals(result, [])
})
