import { assertEquals } from '@std/assert'

import { checkAuth } from './auth.ts'

Deno.test('checkAuth: returns null when no token configured (test env)', () => {
  const req = new Request('http://x/test', { headers: { Authorization: 'Bearer secret' } })
  assertEquals(checkAuth(req), null)
})

Deno.test('checkAuth: returns null for request without headers', () => {
  const req = new Request('http://x/test')
  assertEquals(checkAuth(req), null)
})
