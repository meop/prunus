import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { join } from '@std/path'
import { z } from 'zod'

import { SETTINGS } from '../../../stng.ts'

export function register(server: McpServer): void {
  server.tool(
    'delete_tree',
    'Permanently delete a tree and all its notes. This cannot be undone.',
    {
      name: z.string().describe('Tree name to delete'),
    },
    async (args: { name: string }) => {
      const treePath = join(SETTINGS.grove.path, args.name)
      try {
        await Deno.remove(treePath, { recursive: true })
        return { content: [{ type: 'text', text: `Tree "${args.name}" deleted.` }] }
      } catch {
        return { content: [{ type: 'text', text: `Tree "${args.name}" not found.` }] }
      }
    },
  )
}
