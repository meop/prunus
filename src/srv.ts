import { join } from '@std/path'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'

import { checkAuth } from './auth.ts'
import { config } from './config.ts'
import { initStore } from './db/index.ts'
import { ingest } from './ingest/index.ts'
import { log } from './log.ts'
import { createMcpServer } from './mcp/server.ts'
import { RequestTransport } from './mcp/transport.ts'
import { queueDepth, requeueNullEmbeddings } from './queue.ts'
import { loadProfile } from './vault/profiles.ts'
import { startVaultWatcher } from './vault/watcher.ts'

const CLIENT_DIR = join(import.meta.dirname ?? '', '..', 'client')

async function startup(): Promise<void> {
  await initStore()
  await requeueNullEmbeddings()
  await startVaultWatcher()
  log.info('prunus', 'ready')
}

Deno.serve(
  { hostname: config.server.hostname, port: config.server.port },
  async (req) => {
    const url = new URL(req.url)
    const { pathname } = url

    // ── Client install files (public — no auth) ──────────────────────────────
    const installMatch = pathname.match(/^\/install\/(claude-code|gemini-cli|qwen-code|opencode)$/)
    if (installMatch && req.method === 'GET') {
      return Response.redirect(`${url.origin}/client/${installMatch[1]}/install.ts`, 302)
    }

    if (pathname.startsWith('/client/') && req.method === 'GET') {
      const subpath = pathname.slice('/client/'.length)
      if (!subpath || subpath.includes('..')) return new Response('Not Found', { status: 404 })
      const filePath = join(CLIENT_DIR, subpath)
      try {
        const content = await Deno.readTextFile(filePath)
        const ct = filePath.endsWith('.json') ? 'application/json' : 'text/plain; charset=utf-8'
        return new Response(content, { headers: { 'Content-Type': ct } })
      } catch (e) {
        if (e instanceof Deno.errors.NotFound) return new Response('Not Found', { status: 404 })
        throw e
      }
    }

    const authError = checkAuth(req)
    if (authError) return authError

    // ── Health ──────────────────────────────────────────────────────────────
    if (pathname === '/' && req.method === 'GET') {
      return new Response('prunus', { status: 200 })
    }

    if (pathname === '/health' && req.method === 'GET') {
      return Response.json(await getHealth())
    }

    // ── Context (first-turn injection for client hook) ───────────────────────
    const ctxMatch = pathname.match(/^\/vaults\/([^/]+)\/context$/)
    if (ctxMatch && req.method === 'GET') {
      const vault = ctxMatch[1]
      const profile = await loadProfile(vault, url.searchParams.get('profile') ?? '')
      return Response.json({ profile })
    }

    // ── Ingest ───────────────────────────────────────────────────────────────
    const ingestMatch = pathname.match(/^\/vaults\/([^/]+)\/ingest$/)
    if (ingestMatch && req.method === 'POST') {
      const vault = ingestMatch[1]
      try {
        const body = await req.json()
        const result = await ingest(vault, body)
        return Response.json(result)
      } catch (err) {
        log.error('ingest', 'request failed', String(err))
        return Response.json({ error: String(err) }, { status: 500 })
      }
    }

    // ── MCP ──────────────────────────────────────────────────────────────────
    if (pathname === '/mcp' && req.method === 'POST') {
      const body = (await req.json()) as JSONRPCMessage
      const method = 'method' in body ? String(body.method) : 'unknown'
      log.info('mcp', `→ ${method}`)
      const t0 = performance.now()

      const server = createMcpServer()
      const transport = new RequestTransport()
      await server.connect(transport)
      const response = await transport.dispatch(body)
      await server.close()

      log.info('mcp', `← ${method} ${(performance.now() - t0).toFixed(1)}ms`)
      if (response === null) return new Response(null, { status: 204 })
      return Response.json(response)
    }

    return new Response('Not Found', { status: 404 })
  },
)

log.info('prunus', `listening on ${config.server.hostname}:${config.server.port} (db: ${config.db.type})`)

startup().catch((err) => {
  log.error('prunus', 'startup error', String(err))
  Deno.exit(1)
})

async function getHealth() {
  const { getStore } = await import('./db/index.ts')
  let dbStatus = 'disconnected'
  try {
    await getStore().getNotesNeedingReindex('__health_probe__')
    dbStatus = 'connected'
  } catch (_e) { /* not ready */ }

  let embedService = 'unavailable'
  try {
    const resp = await fetch(`${config.llm.baseUrl}/`, { signal: AbortSignal.timeout(2000) })
    if (resp.ok || resp.status < 500) embedService = 'available'
  } catch (_e) { /* unreachable */ }

  return {
    status: dbStatus === 'connected' ? 'ok' : 'degraded',
    db: `${config.db.type}:${dbStatus}`,
    embed_service: embedService,
    queue_depth: queueDepth(),
  }
}
