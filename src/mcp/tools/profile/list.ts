import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { listEnabledProfiles, listProfileNames } from '../../../tree/profiles.ts'

export function register(server: McpServer): void {
  server.tool(
    'list_profiles',
    'List all available profiles and which are enabled for a tree.',
    {
      tree: z.string().describe('Tree name'),
    },
    async (args: { tree: string }) => {
      const [all, enabled] = await Promise.all([listProfileNames(), listEnabledProfiles(args.tree)])
      if (all.length === 0) {
        return { content: [{ type: 'text', text: 'No profiles available.' }] }
      }
      const enabledSet = new Set(enabled)
      const lines = all.map((n) => `  ${enabledSet.has(n) ? '✓' : ' '} ${n}`)
      return { content: [{ type: 'text', text: `Profiles for tree "${args.tree}":\n${lines.join('\n')}` }] }
    },
  )
}
