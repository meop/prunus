import { join } from '@std/path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { config } from '../../../config.ts'
import { commitFile } from '../../../vault/git.ts'

export function register(server: McpServer): void {
  server.tool(
    'create_profile',
    'Add or replace a capture profile in a vault.',
    {
      vault: z.string().describe('Vault name'),
      name: z.string().describe('Profile name (e.g. "rust" — no .md extension)'),
      content: z.string().describe('Profile content in Markdown'),
    },
    async (args) => {
      const dir = join(config.vault.base, args.vault, '.prunus', 'profiles')
      const path = join(dir, `${args.name}.md`)
      try {
        await Deno.mkdir(dir, { recursive: true })
        await Deno.writeTextFile(path, args.content)
        await commitFile(join(config.vault.base, args.vault), `.prunus/profiles/${args.name}.md`)
        return { content: [{ type: 'text', text: `Profile "${args.name}" saved to vault "${args.vault}".` }] }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${String(err)}` }], isError: true }
      }
    },
  )
}
