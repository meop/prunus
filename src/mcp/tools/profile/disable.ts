import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { disableProfile } from '../../../tree/profiles.ts'

export function register(server: McpServer): void {
  server.tool(
    'disable_profile',
    'Disable a capture profile for a tree (removes the symlink).',
    {
      tree: z.string().describe('Tree name'),
      name: z.string().describe('Profile name to disable'),
    },
    async (args: { tree: string; name: string }) => {
      try {
        await disableProfile(args.tree, args.name)
        return { content: [{ type: 'text', text: `Profile "${args.name}" disabled for tree "${args.tree}".` }] }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${String(err)}` }], isError: true }
      }
    },
  )
}
