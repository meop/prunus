import { join } from '@std/path'

import { SETTINGS } from '../stng.ts'
import { getStore } from '../db/index.ts'
import type { Tool } from '../llm/agent.ts'
import { embed } from '../llm/embed.ts'
import { emptyFrontmatter, parseFrontmatter } from './parser.ts'
import { readNote } from './reader.ts'
import { writeNote } from './writer.ts'

// Returns the set of paths modified during the agent run, for callers to survey.
export function treeTools(tree: string, modified: Set<string>, deleted: Set<string>): Tool[] {
  return [
    {
      name: 'search_notes',
      description: 'Search tree notes by semantic similarity. Returns path, summary, and score.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'number', description: 'Max results (default 5)' },
        },
        required: ['query'],
      },
      async run(args) {
        const query = String(args.query ?? '')
        const limit = Number(args.limit ?? 5)
        const store = getStore()
        try {
          const queryEmbed = await embed(query)
          const results = await store.searchNotes({
            tree,
            queryEmbedding: queryEmbed,
            query,
            limit,
            vectorWeight: SETTINGS.search.vector.weight,
            ftsWeight: SETTINGS.search.fts.weight,
            vectorGate: SETTINGS.search.vector.gate,
          })
          if (results.length === 0) return 'No results.'
          return results.map((r) => `${r.path} (score ${r.score.toFixed(3)}): ${r.summary}`).join('\n')
        } catch (err) {
          return `Search failed: ${String(err)}`
        }
      },
    },
    {
      name: 'read_note',
      description: 'Read the full markdown content of a note by its tree-relative path.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Tree-relative path (e.g. mcp/transport.md)' },
        },
        required: ['path'],
      },
      async run(args) {
        const path = String(args.path ?? '')
        try {
          const { body } = await readNote(tree, path)
          return body
        } catch {
          return `Note not found: ${path}`
        }
      },
    },
    {
      name: 'write_note',
      description: 'Create or update a note. Overwrites content; preserves id and created date if the note exists.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Tree-relative path (e.g. mcp/transport.md)' },
          summary: { type: 'string', description: '2-3 sentence summary for search indexing' },
          content: { type: 'string', description: 'Full markdown body (no frontmatter)' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Topic tags' },
        },
        required: ['path', 'summary', 'content'],
      },
      async run(args) {
        const path = String(args.path ?? '')
        const summary = String(args.summary ?? '')
        const content = String(args.content ?? '')
        const tags = Array.isArray(args.tags) ? args.tags.map(String) : []

        let fm = emptyFrontmatter()
        try {
          const raw = await Deno.readTextFile(join(SETTINGS.grove.path, tree, path))
          const parsed = parseFrontmatter(raw)
          fm = { ...parsed.frontmatter, summary, updated: new Date().toISOString(), tags }
        } catch {
          fm = { ...fm, summary, tags }
        }

        await writeNote(tree, path, fm, content)
        modified.add(path)
        return `Written: ${path}`
      },
    },
    {
      name: 'delete_note',
      description: 'Delete a note from the tree.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Tree-relative path to delete' },
        },
        required: ['path'],
      },
      async run(args) {
        const path = String(args.path ?? '')
        try {
          await Deno.remove(join(SETTINGS.grove.path, tree, path))
          deleted.add(path)
          modified.delete(path)
          return `Deleted: ${path}`
        } catch {
          return `Not found: ${path}`
        }
      },
    },
  ]
}
