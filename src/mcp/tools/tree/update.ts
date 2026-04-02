import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { updateTree } from '../../../ingest/index.ts'
import { log } from '../../../log.ts'

export function register(server: McpServer): void {
  server.tool(
    'update_tree',
    'Contribute a prepared session summary document to be analyzed and filed into the tree by the prunus arborist.',
    {
      tree: z.string().describe('Target tree name'),
      project: z.string().describe('Project name'),
      document: z.string().describe('Prepared summary document produced by the session AI'),
    },
    (args: { tree: string; project: string; document: string }) => {
      updateTree(args.tree, { project: args.project, document: args.document }).catch((err) =>
        log.error('updateTree', 'background processing failed', String(err))
      )
      return { content: [{ type: 'text', text: 'Document received.' }] }
    },
  )
}
