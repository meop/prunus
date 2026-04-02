import { walk } from '@std/fs'
import { join } from '@std/path'

import { SETTINGS } from '../stng.ts'
import { chat } from '../llm/chat.ts'
import { log } from '../log.ts'
import { enqueue } from '../queue.ts'
import { loadProfile } from '../tree/profiles.ts'

export interface UpdateTreeRequest {
  project: string
  document: string
}

interface Chunk {
  topic: string
  excerpt: string
}

const ANALYSIS_PROMPT =
  `You are a knowledge librarian receiving a prepared session summary document from an AI developer assistant.
{{profile}}
The document summarizes conclusions, decisions, and validated approaches from a work session — dead ends and failed attempts have already been filtered out by the author.

For each distinct piece of knowledge in the document, provide:
- "topic": 1-2 sentence description of what was learned or decided
- "excerpt": the relevant portion of the document capturing this knowledge (verbatim or lightly edited, enough context to reconstruct the insight independently)

Be selective — only extract knowledge matching the tree profile above.
Each chunk must be self-contained: a reader with no other context should understand what was learned.

Respond with JSON only (empty array if nothing worth saving):
[{"topic": "...", "excerpt": "..."}]`

async function listTreeFiles(tree: string): Promise<string[]> {
  const treePath = join(SETTINGS.grove.path, tree)
  const files: string[] = []
  try {
    for await (const entry of walk(treePath, { exts: ['.md'], includeDirs: false })) {
      files.push(entry.path.slice(treePath.length + 1))
    }
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e
  }
  return files.sort()
}

export async function updateTree(tree: string, req: UpdateTreeRequest): Promise<void> {
  if (!SETTINGS.llm.chat.model) {
    log.warn('updateTree', 'llm.chat.model not set — skipping')
    return
  }

  const [profile, treeFiles] = await Promise.all([loadProfile(tree), listTreeFiles(tree)])

  if (!profile) {
    log.info('updateTree', `[${tree}] no active profiles — skipping`)
    return
  }

  log.info('updateTree', `[${tree}] analyzing document (project: ${req.project})`)

  const profileSection = `\nGROVE PROFILE:\n${profile}\n`
  const systemPrompt = ANALYSIS_PROMPT.replace('{{profile}}', profileSection)
  const treeSection = treeFiles.length > 0
    ? `\nCurrent tree files:\n${treeFiles.map((f) => `  ${f}`).join('\n')}\n`
    : ''

  let chunks: Chunk[] = []
  try {
    const response = await chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Project: ${req.project}${treeSection}\nDocument:\n${req.document}` },
    ])
    chunks = parseChunks(response)
  } catch (err) {
    log.error('updateTree', 'analysis failed', String(err))
    return
  }

  if (chunks.length === 0) {
    log.info('updateTree', `[${tree}] no knowledge chunks extracted`)
    return
  }

  log.info('updateTree', `[${tree}] identified ${chunks.length} chunk(s), enqueueing`)

  for (const chunk of chunks) {
    enqueue({ type: 'grow', tree, topic: chunk.topic, excerpt: chunk.excerpt })
  }
}

export function parseChunks(text: string): Chunk[] {
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) return []
  try {
    const parsed = JSON.parse(match[0])
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is Chunk =>
      typeof x === 'object' && x !== null &&
      typeof x.topic === 'string' &&
      typeof x.excerpt === 'string'
    )
  } catch {
    return []
  }
}
