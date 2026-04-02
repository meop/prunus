import { assertEquals } from '@std/assert'

import { checkAuth, timingSafeEqual } from './auth.ts'

Deno.test('checkAuth: returns null when no token configured (test env)', () => {
  const req = new Request('http://x/test', { headers: { Authorization: 'Bearer secret' } })
  assertEquals(checkAuth(req), null)
})

Deno.test('checkAuth: returns null for request without headers', () => {
  const req = new Request('http://x/test')
  assertEquals(checkAuth(req), null)
})

Deno.test('timingSafeEqual: returns true for identical strings', () => {
  assertEquals(timingSafeEqual('hello', 'hello'), true)
})

Deno.test('timingSafeEqual: returns false for different strings', () => {
  assertEquals(timingSafeEqual('hello', 'world'), false)
})

Deno.test('timingSafeEqual: returns true for empty strings', () => {
  assertEquals(timingSafeEqual('', ''), true)
})

Deno.test('timingSafeEqual: returns false when lengths differ', () => {
  assertEquals(timingSafeEqual('short', 'much-longer-string'), false)
})

Deno.test('timingSafeEqual: returns false for near-miss strings', () => {
  assertEquals(timingSafeEqual('secret', 'secretx'), false)
})
