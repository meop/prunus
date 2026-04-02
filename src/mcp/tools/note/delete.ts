import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { join } from '@std/path'
import { z } from 'zod'

import { SETTINGS } from '../../../stng.ts'

export function register(server: McpServer): void {
  server.tool(
    'delete_note',
    'Permanently delete a note from a tree. The watcher handles link cleanup and index removal.',
    {
      tree: z.string().describe('Tree name'),
      path: z.string().describe('Tree-relative path (e.g. prunus/slash-command-design.md)'),
    },
    async (args: { tree: string; path: string }) => {
      const abs = join(SETTINGS.grove.path, args.tree, args.path)
      try {
        await Deno.remove(abs)
        return { content: [{ type: 'text', text: `Note "${args.path}" deleted from tree "${args.tree}".` }] }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${String(err)}` }], isError: true }
      }
    },
  )
}
