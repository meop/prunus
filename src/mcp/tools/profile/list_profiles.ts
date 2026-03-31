import { join } from '@std/path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { config } from '../../../config.ts'

export function register(server: McpServer): void {
  server.tool(
    'list_profiles',
    'List the capture profiles active for a vault.',
    {
      vault: z.string().describe('Vault name'),
    },
    async (args) => {
      const dir = join(config.vault.base, args.vault, '.prunus', 'profiles')
      const profiles: Array<{ name: string; title: string }> = []

      try {
        for await (const entry of Deno.readDir(dir)) {
          if (!entry.isFile || !entry.name.endsWith('.md')) continue
          const text = await Deno.readTextFile(join(dir, entry.name)).catch(() => '')
          const title = text.match(/^#\s+(.+)/m)?.[1]?.trim() ?? entry.name.replace(/\.md$/, '')
          profiles.push({ name: entry.name.replace(/\.md$/, ''), title })
        }
      } catch {
        return { content: [{ type: 'text', text: `No profiles found for vault "${args.vault}".` }] }
      }

      if (profiles.length === 0) {
        return { content: [{ type: 'text', text: `No profiles found for vault "${args.vault}".` }] }
      }

      profiles.sort((a, b) => a.name.localeCompare(b.name))
      return { content: [{ type: 'text', text: JSON.stringify(profiles, null, 2) }] }
    },
  )
}
