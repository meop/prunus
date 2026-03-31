import { join } from '@std/path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { config } from '../../../config.ts'
import { getStore } from '../../../db/index.ts'
import { enqueue } from '../../../queue.ts'
import { commitFile } from '../../../vault/git.ts'
import { readNote } from '../../../vault/reader.ts'
import { writeNote } from '../../../vault/writer.ts'

export function register(server: McpServer): void {
  server.tool(
    'update_note',
    'Update the content or summary of an existing note without changing its identity, creation date, or project history.',
    {
      vault: z.string().describe('Vault name'),
      id: z.string().describe('Note UUID'),
      content: z.string().describe('New Markdown body'),
      summary: z.string().describe('New summary'),
    },
    async (args) => {
      try {
        const record = await getStore().getNoteById(args.id)
        if (!record) return { content: [{ type: 'text', text: `Note not found: ${args.id}` }], isError: true }
        if (record.vault !== args.vault) {
          return {
            content: [{ type: 'text', text: `Note ${args.id} belongs to vault ${record.vault}` }],
            isError: true,
          }
        }

        const { frontmatter: fm } = await readNote(args.vault, record.path)
        const updated = { ...fm, summary: args.summary, updated: new Date().toISOString() }

        await writeNote(args.vault, record.path, updated, args.content)
        enqueue({ type: 'reindex', vault: args.vault, path: record.path })
        await commitFile(join(config.vault.base, args.vault), record.path)

        return { content: [{ type: 'text', text: `Updated: ${args.vault}/${record.path}` }] }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${String(err)}` }], isError: true }
      }
    },
  )
}
