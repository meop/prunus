import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { join } from '@std/path'
import { z } from 'zod'

import { SETTINGS } from '../../../stng.ts'

export function register(server: McpServer): void {
  server.tool(
    'create_tree',
    'Create a new named tree. Use create_profile to configure what it captures.',
    {
      name: z.string().describe('Tree name (lowercase, no spaces)'),
    },
    async (args: { name: string }) => {
      const treePath = join(SETTINGS.grove.path, args.name)
      try {
        await Deno.mkdir(treePath, { recursive: true })
        return { content: [{ type: 'text', text: `Tree "${args.name}" created. Add profiles with create_profile.` }] }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${String(err)}` }], isError: true }
      }
    },
  )
}
