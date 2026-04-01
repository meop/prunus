import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { join } from '@std/path'
import { z } from 'zod'

import { config } from '../../../config.ts'

export function register(server: McpServer): void {
  server.tool(
    'create_vault',
    'Create a new named vault. Use create_profile to configure what it captures.',
    {
      name: z.string().describe('Vault name (lowercase, no spaces)'),
    },
    async (args) => {
      const vaultPath = join(config.vault.base, args.name)
      try {
        await Deno.mkdir(vaultPath, { recursive: true })
        return { content: [{ type: 'text', text: `Vault "${args.name}" created. Add profiles with create_profile.` }] }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${String(err)}` }], isError: true }
      }
    },
  )
}
