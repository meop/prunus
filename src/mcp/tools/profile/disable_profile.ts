import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { disableProfile } from '../../../vault/profiles.ts'

export function register(server: McpServer): void {
  server.tool(
    'disable_profile',
    'Disable a capture profile for a vault (removes the symlink).',
    {
      vault: z.string().describe('Vault name'),
      name: z.string().describe('Profile name to disable'),
    },
    async (args) => {
      try {
        await disableProfile(args.vault, args.name)
        return { content: [{ type: 'text', text: `Profile "${args.name}" disabled for vault "${args.vault}".` }] }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${String(err)}` }], isError: true }
      }
    },
  )
}
