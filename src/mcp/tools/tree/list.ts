import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { SETTINGS } from '../../../stng.ts'

export function register(server: McpServer): void {
  server.tool(
    'list_trees',
    'List available tree names on this prunus server.',
    {},
    async () => {
      try {
        const trees: string[] = []
        for await (const entry of Deno.readDir(SETTINGS.grove.path)) {
          if (entry.isDirectory && !entry.name.startsWith('.')) trees.push(entry.name)
        }
        return { content: [{ type: 'text', text: JSON.stringify(trees) }] }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${String(err)}` }], isError: true }
      }
    },
  )
}
