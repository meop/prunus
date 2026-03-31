import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { config } from '../../../config.ts'

export function register(server: McpServer): void {
  server.tool(
    'list_vaults',
    'List available vault names on this prunus server.',
    {},
    async () => {
      try {
        const vaults: string[] = []
        for await (const entry of Deno.readDir(config.vault.base)) {
          if (entry.isDirectory && !entry.name.startsWith('.')) vaults.push(entry.name)
        }
        return { content: [{ type: 'text', text: JSON.stringify(vaults) }] }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${String(err)}` }], isError: true }
      }
    },
  )
}
