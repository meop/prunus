import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ensureDir } from '@std/fs'
import { dirname, join } from '@std/path'
import { z } from 'zod'

import { SETTINGS } from '../../../stng.ts'
import { buildNoteContent, emptyFrontmatter } from '../../../tree/parser.ts'

export function register(server: McpServer): void {
  server.tool(
    'create_note',
    'Create a new note in a tree. Fails if the path already exists.',
    {
      tree: z.string().describe('Tree name'),
      path: z.string().describe('Tree-relative path (e.g. typescript/decorators.md)'),
      body: z.string().describe('Markdown body content (no frontmatter)'),
      summary: z.string().optional().describe('One-line summary used for search indexing'),
    },
    async (args: { tree: string; path: string; body: string; summary?: string }) => {
      const abs = join(SETTINGS.grove.path, args.tree, args.path)
      try {
        const fm = emptyFrontmatter()
        if (args.summary) fm.summary = args.summary
        const content = buildNoteContent(fm, args.body)
        await ensureDir(dirname(abs))
        const file = await Deno.open(abs, { write: true, createNew: true })
        await file.write(new TextEncoder().encode(content))
        file.close()
        return { content: [{ type: 'text', text: `Note "${args.path}" created in tree "${args.tree}".` }] }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${String(err)}` }], isError: true }
      }
    },
  )
}
