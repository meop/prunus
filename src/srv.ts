import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { join } from '@std/path'

import { checkAuth } from './auth.ts'
import { config } from './config.ts'
import { getStore, initStore } from './db/index.ts'
import { getHealth } from './health.ts'
import { ingest } from './ingest/index.ts'
import { log } from './log.ts'
import { embed } from './llm/embed.ts'
import { createMcpServer } from './mcp/server.ts'
import { RequestTransport } from './mcp/transport.ts'
import { initQueue, requeueNullEmbeddings } from './queue.ts'
import { startVaultWatcher } from './vault/watcher.ts'

const ROUTE_CLI = '/cli'
const ROUTE_HEALTH = '/health'
const ROUTE_MCP = '/mcp'
const ROUTE_VAULT = '/vault'

const SUBPATH_CLI = join(import.meta.dirname ?? '', 'cli')

async function startup(): Promise<void> {
  await initStore()
  await initQueue()
  await requeueNullEmbeddings()
  await startVaultWatcher()
  log.info('prunus', 'ready')
}

Deno.serve(
  { hostname: config.server.hostname, port: config.server.port },
  async (req) => {
    const url = new URL(req.url)
    const { pathname } = url

    // ── Probe ───────────────────────────────────────────────────────────────
    if (pathname === '/' && req.method === 'GET') {
      return new Response('prunus', { status: 200 })
    }

    // ── Client install files (public — no auth) ──────────────────────────────
    if (pathname === `${ROUTE_CLI}/install` && req.method === 'GET') {
      return Response.redirect(`${url.origin}${ROUTE_CLI}/install.ts`, 302)
    }

    if (pathname.startsWith(`${ROUTE_CLI}/`) && req.method === 'GET') {
      const subpath = pathname.slice(`${ROUTE_CLI}/`.length)
      if (!subpath || subpath.includes('..')) return new Response('Not Found', { status: 404 })
      const filePath = join(SUBPATH_CLI, subpath)
      try {
        const content = await Deno.readTextFile(filePath)
        const ct = filePath.endsWith('.json') ? 'application/json' : 'text/plain; charset=utf-8'
        return new Response(content, { headers: { 'Content-Type': ct } })
      } catch (e) {
        if (e instanceof Deno.errors.NotFound) return new Response('Not Found', { status: 404 })
        throw e
      }
    }

    // ── Health (public — no auth, no sensitive data) ────────────────────────
    if (pathname === ROUTE_HEALTH && req.method === 'GET') {
      return Response.json(await getHealth())
    }

    const authError = checkAuth(req)
    if (authError) return authError

    // ── Vault routes ────────────────────────────────────────────────────────
    const ctxMatch = pathname.match(new RegExp(`^${ROUTE_VAULT}/([^/]+)/context$`))
    if (ctxMatch && req.method === 'GET') {
      const vault = ctxMatch[1]
      const query = url.searchParams.get('query')?.trim()
      if (!query) return Response.json({ notes: [] })

      const store = getStore()
      let results: Array<{ path: string; summary: string }> = []

      if (config.llm.embedModel) {
        try {
          const queryEmbedding = await embed(query)
          results = await store.searchNotes({
            vault,
            queryEmbedding,
            query,
            limit: 5,
            vectorWeight: config.search.vectorWeight,
            ftsWeight: config.search.ftsWeight,
            vectorGate: config.search.vectorGate,
          })
        } catch {
          results = await store.searchNotesFts(vault, query, 5)
        }
      } else {
        results = await store.searchNotesFts(vault, query, 5)
      }

      const notes = results.map((r) => ({ path: r.path, summary: r.summary }))
      return Response.json({ notes })
    }

    const ingestMatch = pathname.match(new RegExp(`^${ROUTE_VAULT}/([^/]+)/ingest$`))
    if (ingestMatch && req.method === 'POST') {
      const vault = ingestMatch[1]
      const body = await req.json()
      ingest(vault, body).catch((err) => log.error('ingest', 'background ingest failed', String(err)))
      return new Response(null, { status: 202 })
    }

    // ── MCP ──────────────────────────────────────────────────────────────────
    if (pathname === ROUTE_MCP && req.method === 'POST') {
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
