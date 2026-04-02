import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { walk } from '@std/fs'
import { join, relative } from '@std/path'
import { z } from 'zod'

import { SETTINGS } from '../../../stng.ts'

export function register(server: McpServer): void {
  server.tool(
    'list_notes',
    'List all note paths in a tree.',
    {
      tree: z.string().describe('Tree name'),
    },
    async (args: { tree: string }) => {
      const treePath = join(SETTINGS.grove.path, args.tree)
      try {
        const paths: string[] = []
        for await (const entry of walk(treePath, { exts: ['.md'], includeDirs: false })) {
          paths.push(relative(treePath, entry.path))
        }
        paths.sort()
        return { content: [{ type: 'text', text: JSON.stringify(paths) }] }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${String(err)}` }], isError: true }
      }
    },
  )
}
