import { join } from '@std/path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { config } from '../../../config.ts'
import { commitRemove } from '../../../vault/git.ts'

export function register(server: McpServer): void {
  server.tool(
    'delete_profile',
    'Remove a capture profile from a vault.',
    {
      vault: z.string().describe('Vault name'),
      name: z.string().describe('Profile name to remove (no .md extension)'),
    },
    async (args) => {
      const path = join(config.vault.base, args.vault, '.prunus', 'profiles', `${args.name}.md`)
      try {
        await Deno.remove(path)
        await commitRemove(join(config.vault.base, args.vault), `.prunus/profiles/${args.name}.md`)
        return { content: [{ type: 'text', text: `Profile "${args.name}" removed from vault "${args.vault}".` }] }
      } catch {
        return { content: [{ type: 'text', text: `Profile "${args.name}" not found in vault "${args.vault}".` }] }
      }
    },
  )
}
