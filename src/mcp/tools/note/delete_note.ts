import { join } from '@std/path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { config } from '../../../config.ts'
import { getStore } from '../../../db/index.ts'
import { enqueue } from '../../../queue.ts'
import { commitRemove } from '../../../vault/git.ts'

export function register(server: McpServer): void {
  server.tool(
    'delete_note',
    'Delete a note from the vault by path or id.',
    {
      vault: z.string().describe('Vault name'),
      path: z.string().optional().describe('Vault-relative path (e.g. typescript/decorators.md)'),
      id: z.string().optional().describe('Note UUID (alternative to path)'),
    },
    async (args) => {
      try {
        let notePath = args.path
        if (!notePath) {
          if (!args.id) return { content: [{ type: 'text', text: 'Provide path or id.' }], isError: true }
          const row = await getStore().getNoteById(args.id)
          if (!row || row.vault !== args.vault) {
            return { content: [{ type: 'text', text: 'Note not found.' }] }
          }
          notePath = row.path
        }

        const abs = join(config.vault.base, args.vault, notePath)
        try {
          await Deno.remove(abs)
        } catch { /* already gone */ }

        enqueue({ type: 'delete', vault: args.vault, path: notePath })
        await commitRemove(join(config.vault.base, args.vault), notePath)

        return { content: [{ type: 'text', text: `Deleted: ${args.vault}/${notePath}` }] }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${String(err)}` }], isError: true }
      }
    },
  )
}
