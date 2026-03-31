import { join } from '@std/path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { config } from '../../../config.ts'
import { commitFile } from '../../../vault/git.ts'

export function register(server: McpServer): void {
  server.tool(
    'update_profile',
    'Update the content of an existing capture profile in a vault.',
    {
      vault: z.string().describe('Vault name'),
      name: z.string().describe('Profile name (e.g. "rust" — no .md extension)'),
      content: z.string().describe('New profile content in Markdown'),
    },
    async (args) => {
      const path = join(config.vault.base, args.vault, '.prunus', 'profiles', `${args.name}.md`)
      try {
        await Deno.stat(path) // ensure it exists
        await Deno.writeTextFile(path, args.content)
        await commitFile(join(config.vault.base, args.vault), `.prunus/profiles/${args.name}.md`)
        return { content: [{ type: 'text', text: `Profile "${args.name}" updated in vault "${args.vault}".` }] }
      } catch (err) {
        if (err instanceof Deno.errors.NotFound) {
          return {
            content: [{ type: 'text', text: `Profile "${args.name}" not found in vault "${args.vault}".` }],
            isError: true,
          }
        }
        return { content: [{ type: 'text', text: `Error: ${String(err)}` }], isError: true }
      }
    },
  )
}
