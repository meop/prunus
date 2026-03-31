import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { readNote } from '../../../vault/reader.ts'
import { getStore } from '../../../db/index.ts'
import { buildNoteContent } from '../../../vault/parser.ts'

export function register(server: McpServer): void {
  server.tool(
    'read_note',
    'Read a note from the vault by path or by ID. Returns the full Markdown content.',
    {
      vault: z.string().describe('Vault name'),
      path: z.string().optional().describe('Vault-relative path (e.g. typescript/decorators.md)'),
      id: z.string().optional().describe('Note UUID (alternative to path)'),
    },
    async (args) => {
      try {
        let vaultPath = args.path

        if (!vaultPath && args.id) {
          const record = await getStore().getNoteById(args.id)
          if (!record) return { content: [{ type: 'text', text: `Note not found: ${args.id}` }], isError: true }
          if (record.vault !== args.vault) {
            return {
              content: [{ type: 'text', text: `Note ${args.id} belongs to vault ${record.vault}, not ${args.vault}` }],
              isError: true,
            }
          }
          vaultPath = record.path
        }

        if (!vaultPath) return { content: [{ type: 'text', text: 'Provide either path or id' }], isError: true }

        const { frontmatter: fm, body } = await readNote(args.vault, vaultPath)
        return { content: [{ type: 'text', text: buildNoteContent(fm, body) }] }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${String(err)}` }], isError: true }
      }
    },
  )
}
