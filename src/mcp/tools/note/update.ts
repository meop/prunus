import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { readNote } from '../../../tree/reader.ts'
import { writeNote } from '../../../tree/writer.ts'

export function register(server: McpServer): void {
  server.tool(
    'update_note',
    'Update the body of an existing note. Preserves id and created timestamp. Fails if the note does not exist.',
    {
      tree: z.string().describe('Tree name'),
      path: z.string().describe('Tree-relative path (e.g. typescript/decorators.md)'),
      body: z.string().describe('New Markdown body content (no frontmatter)'),
      summary: z.string().optional().describe('Updated one-line summary (leave unset to keep existing)'),
    },
    async (args: { tree: string; path: string; body: string; summary?: string }) => {
      try {
        const { frontmatter: fm } = await readNote(args.tree, args.path)
        fm.updated = new Date().toISOString()
        if (args.summary !== undefined) fm.summary = args.summary
        await writeNote(args.tree, args.path, fm, args.body)
        return { content: [{ type: 'text', text: `Note "${args.path}" updated.` }] }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${String(err)}` }], isError: true }
      }
    },
  )
}
