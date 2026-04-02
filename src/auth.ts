import { SETTINGS } from './stng.ts'

export function checkAuth(req: Request): Response | null {
  const token = SETTINGS.srv?.auth?.token ?? ''
  if (!token) return null // no auth configured

  const header = req.headers.get('Authorization')
  if (!header?.startsWith('Bearer ')) {
    return new Response('Unauthorized', { status: 401 })
  }
  if (!timingSafeEqual(token, header.slice(7))) {
    return new Response('Unauthorized', { status: 401 })
  }
  return null
}

export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  // Pad both to 256 chars so length doesn't leak
  const aBytes = enc.encode(a.padEnd(256).slice(0, 256))
  const bBytes = enc.encode(b.padEnd(256).slice(0, 256))
  let diff = a.length ^ b.length
  for (let i = 0; i < 256; i++) diff |= aBytes[i] ^ bBytes[i]
  return diff === 0
}
