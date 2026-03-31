import { join } from '@std/path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import { config } from '../../../config.ts'
import { enqueue } from '../../../queue.ts'
import { commitFile } from '../../../vault/git.ts'
import { emptyFrontmatter, parseFrontmatter } from '../../../vault/parser.ts'
import { writeNote } from '../../../vault/writer.ts'

export function register(server: McpServer): void {
  server.tool(
    'create_note',
    'Save a note to the vault. Creates the file if new; updates it if it already exists, appending the current project to its projects list.',
    {
      vault: z.string().describe('Vault name (e.g. code, recipe)'),
      filename: z.string().describe('Path relative to vault root (e.g. typescript/decorators.md)'),
      content: z.string().describe('Markdown body (frontmatter is managed by the server)'),
      summary: z.string().describe('2-3 sentence summary used for search and embeddings'),
      project: z.string().describe('Current project name (cwd basename)'),
      tags: z.array(z.string()).optional().describe('Topic tags'),
    },
    async (args) => {
      try {
        const vaultFilePath = join(config.vault.base, args.vault, args.filename)
        const now = new Date().toISOString()

        // Read existing frontmatter to preserve id, created, and accumulated projects
        let fm = emptyFrontmatter()
        try {
          const existing = await Deno.readTextFile(vaultFilePath)
          const parsed = parseFrontmatter(existing)
          fm = {
            ...parsed.frontmatter,
            summary: args.summary,
            updated: now,
            projects: [...new Set([...parsed.frontmatter.projects, args.project])],
            tags: args.tags ?? parsed.frontmatter.tags,
          }
        } catch {
          // New file
          fm = {
            ...fm,
            summary: args.summary,
            projects: [args.project],
            tags: args.tags ?? [],
          }
        }

        await writeNote(args.vault, args.filename, fm, args.content)
        enqueue({ type: 'reindex', vault: args.vault, path: args.filename })
        await commitFile(join(config.vault.base, args.vault), args.filename)

        return { content: [{ type: 'text', text: `Saved: ${args.vault}/${args.filename}` }] }
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${String(err)}` }], isError: true }
      }
    },
  )
}
