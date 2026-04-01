import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { config } from '../../../config.ts'
import { getStore } from '../../../db/index.ts'
import { embed } from '../../../llm/embed.ts'

export function register(server: McpServer): void {
  server.tool(
    'search_notes',
    'Search the knowledge vault by semantic similarity. Returns compact summaries — use read_note to get full content.',
    {
      vault: z.string().describe('Vault name (e.g. code, recipe)'),
      query: z.string().describe('Natural language search query'),
      limit: z.number().optional().describe('Max results (default 5)'),
    },
    async (args) => {
      try {
        const store = getStore()
        const limit = args.limit ?? 5

        let results
        try {
          const queryEmbedding = await embed(args.query)
          results = await store.searchNotes({
            vault: args.vault,
            queryEmbedding,
            query: args.query,
            limit,
            vectorWeight: config.search.vectorWeight,
            ftsWeight: config.search.ftsWeight,
            vectorGate: config.search.vectorGate,
          })
        } catch {
          // Embed service unavailable — fall back to FTS only
          results = await store.searchNotesFts(args.vault, args.query, limit)
        }

        if (results.length === 0) {
          return { content: [{ type: 'text', text: 'No results found.' }] }
        }

        const out = results.map((r) => ({
          path: r.path,
          summary: r.summary,
          projects: r.projects,
          score: Math.round(r.score * 1000) / 1000,
        }))

        return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${String(err)}` }], isError: true }
      }
    },
  )
}
