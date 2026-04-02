import { assertEquals } from '@std/assert'

import { cosineDistance, toFts5Query } from './sqlite.ts'

Deno.test('toFts5Query: splits words and quotes them', () => {
  assertEquals(toFts5Query('hello world'), '"hello" "world"')
})

Deno.test('toFts5Query: single word', () => {
  assertEquals(toFts5Query('hello'), '"hello"')
})

Deno.test('toFts5Query: filters out single-char words', () => {
  assertEquals(toFts5Query('a big test'), '"big" "test"')
})

Deno.test('toFts5Query: returns empty for empty string', () => {
  assertEquals(toFts5Query(''), '')
})

Deno.test('toFts5Query: returns empty for whitespace only', () => {
  assertEquals(toFts5Query('   '), '')
})

Deno.test('toFts5Query: returns empty for single-char input', () => {
  assertEquals(toFts5Query('x'), '')
})

Deno.test('toFts5Query: escapes double quotes in words', () => {
  assertEquals(toFts5Query('say "hello"'), '"say" """hello"""')
})

Deno.test('toFts5Query: handles multiple spaces between words', () => {
  assertEquals(toFts5Query('word1   word2'), '"word1" "word2"')
})

Deno.test('cosineDistance: returns 0 for identical vectors', () => {
  assertEquals(cosineDistance([1, 0, 0], [1, 0, 0]), 0)
})

Deno.test('cosineDistance: returns 2 for opposite vectors', () => {
  const dist = cosineDistance([1, 0], [-1, 0])
  assertEquals(dist, 2)
})

Deno.test('cosineDistance: returns 1 for zero vectors', () => {
  assertEquals(cosineDistance([0, 0, 0], [1, 2, 3]), 1)
})

Deno.test('cosineDistance: returns 1 for both zero vectors', () => {
  assertEquals(cosineDistance([0, 0], [0, 0]), 1)
})

Deno.test('cosineDistance: orthogonal vectors give distance 1', () => {
  const dist = cosineDistance([1, 0], [0, 1])
  assertEquals(dist, 1)
})

Deno.test('cosineDistance: similar vectors give small distance', () => {
  const dist = cosineDistance([1, 1], [1.01, 1.01])
  assertEquals(dist < 0.001, true)
})
