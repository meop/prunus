import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { getStore } from '../../../db/index.ts'
import { buildNoteContent } from '../../../tree/parser.ts'
import { readNote } from '../../../tree/reader.ts'

export function register(server: McpServer): void {
  server.tool(
    'read_note',
    'Read a note from the tree by path or by ID. Returns the full Markdown content. Notes may contain [[wikilinks]] and a "## See also" section — follow those links with additional read_note calls to retrieve related knowledge.',
    {
      tree: z.string().describe('Tree name'),
      path: z.string().optional().describe('Tree-relative path (e.g. typescript/decorators.md)'),
      id: z.string().optional().describe('Note UUID (alternative to path)'),
    },
    async (args: { tree: string; path?: string; id?: string }) => {
      try {
        let treePath = args.path

        if (!treePath && args.id) {
          const record = await getStore().getNoteById(args.id)
          if (!record) return { content: [{ type: 'text', text: `Note not found: ${args.id}` }], isError: true }
          if (record.tree !== args.tree) {
            return {
              content: [{ type: 'text', text: `Note ${args.id} belongs to tree ${record.tree}, not ${args.tree}` }],
              isError: true,
            }
          }
          treePath = record.path
        }

        if (!treePath) return { content: [{ type: 'text', text: 'Provide either path or id' }], isError: true }

        const { frontmatter: fm, body } = await readNote(args.tree, treePath)
        return { content: [{ type: 'text', text: buildNoteContent(fm, body) }] }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${String(err)}` }], isError: true }
      }
    },
  )
}
