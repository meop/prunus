import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { join } from '@std/path'
import { z } from 'zod'

import { config } from '../../../config.ts'

export function register(server: McpServer): void {
  server.tool(
    'delete_vault',
    'Permanently delete a vault and all its notes. This cannot be undone.',
    {
      name: z.string().describe('Vault name to delete'),
    },
    async (args) => {
      const vaultPath = join(config.vault.base, args.name)
      try {
        await Deno.remove(vaultPath, { recursive: true })
        return { content: [{ type: 'text', text: `Vault "${args.name}" deleted.` }] }
      } catch {
        return { content: [{ type: 'text', text: `Vault "${args.name}" not found.` }] }
      }
    },
  )
}
