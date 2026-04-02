import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { enableProfile } from '../../../tree/profiles.ts'

export function register(server: McpServer): void {
  server.tool(
    'enable_profile',
    'Enable a capture profile for a tree (creates a symlink).',
    {
      tree: z.string().describe('Tree name'),
      name: z.string().describe('Profile name (e.g. "software-architect")'),
    },
    async (args: { tree: string; name: string }) => {
      try {
        await enableProfile(args.tree, args.name)
        return { content: [{ type: 'text', text: `Profile "${args.name}" enabled for tree "${args.tree}".` }] }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${String(err)}` }], isError: true }
      }
    },
  )
}
