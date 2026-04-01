import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { enableProfile } from '../../../vault/profiles.ts'

export function register(server: McpServer): void {
  server.tool(
    'enable_profile',
    'Enable a capture profile for a vault (creates a symlink).',
    {
      vault: z.string().describe('Vault name'),
      name: z.string().describe('Profile name (e.g. "software-architect")'),
    },
    async (args) => {
      try {
        await enableProfile(args.vault, args.name)
        return { content: [{ type: 'text', text: `Profile "${args.name}" enabled for vault "${args.vault}".` }] }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${String(err)}` }], isError: true }
      }
    },
  )
}
