import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { embed } from '../../../llm/embed.ts'
import { getStore } from '../../../db/index.ts'
import { config } from '../../../config.ts'

export function register(server: McpServer): void {
  server.tool(
    'suggest_links',
    'Suggest existing vault notes semantically similar to a draft, for use as [[wikilinks]].',
    {
      vault: z.string().describe('Vault name'),
      draft: z.string().describe('Draft content or description to find related notes for'),
      limit: z.number().optional().describe('Max suggestions (default 5)'),
    },
    async (args) => {
      try {
        const queryEmbedding = await embed(args.draft.slice(0, 500))
        const results = await getStore().searchNotes({
          vault: args.vault,
          queryEmbedding,
          query: args.draft.slice(0, 200),
          limit: args.limit ?? 5,
          vectorWeight: config.search.vectorWeight,
          ftsWeight: config.search.ftsWeight,
          vectorGate: config.search.vectorGate,
        })

        if (results.length === 0) return { content: [{ type: 'text', text: 'No related notes found.' }] }

        const out = results.map((r) => ({
          wikilink: `[[${r.path.replace(/\.md$/, '')}]]`,
          summary: r.summary,
          score: Math.round(r.score * 1000) / 1000,
        }))

        return { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${String(err)}` }], isError: true }
      }
    },
  )
}
