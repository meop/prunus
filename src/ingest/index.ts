import { walk } from '@std/fs'
import { join } from '@std/path'

import { config } from '../config.ts'
import { chat } from '../llm/chat.ts'
import { log } from '../log.ts'
import { enqueue } from '../queue.ts'
import { loadProfile } from '../vault/profiles.ts'

export interface TranscriptEntry {
  role: 'user' | 'assistant'
  content: string
  ts?: string
}

export interface IngestRequest {
  project: string
  transcript: TranscriptEntry[]
  since?: string
}

export interface IngestResult {
  chunks: number
}

interface Chunk {
  topic: string
  excerpt: string
}

const ANALYSIS_PROMPT =
  `You are analyzing a developer's session transcript to identify distinct pieces of knowledge worth saving to the vault.
{{profile}}
For each piece of knowledge, provide:
- "topic": 1-2 sentence description of what was learned
- "excerpt": the relevant portion of the transcript that captures this knowledge (verbatim or lightly edited, enough context to reconstruct the insight)

Be selective — only extract knowledge matching the vault profile above.
Each chunk should be self-contained: a reader with no other context should understand what was learned.

Respond with JSON only (empty array if nothing worth saving):
[{"topic": "...", "excerpt": "..."}]`

async function listVaultFiles(vault: string): Promise<string[]> {
  const vaultPath = join(config.vault.base, vault)
  const files: string[] = []
  try {
    for await (const entry of walk(vaultPath, { exts: ['.md'], includeDirs: false })) {
      files.push(entry.path.slice(vaultPath.length + 1))
    }
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e
  }
  return files.sort()
}

export async function ingest(vault: string, req: IngestRequest): Promise<IngestResult> {
  if (!config.llm.chatModel) {
    log.warn('ingest', 'llm.chat.model not set — skipping')
    return { chunks: 0 }
  }

  let entries = req.transcript
  if (req.since) {
    const since = new Date(req.since).getTime()
    entries = entries.filter((e) => !e.ts || new Date(e.ts).getTime() > since)
  }
  if (entries.length < 2) return { chunks: 0 }

  const [profile, vaultFiles] = await Promise.all([loadProfile(vault), listVaultFiles(vault)])

  if (!profile) {
    log.info('ingest', `vault=${vault} has no active profiles — skipping`)
    return { chunks: 0 }
  }

  log.info('ingest', `analyzing ${entries.length} turns for vault=${vault} project=${req.project}`)

  const transcriptText = entries.map((e) => `${e.role.toUpperCase()}: ${e.content}`).join('\n\n')
  const profileSection = `\nVAULT PROFILE:\n${profile}\n`
  const systemPrompt = ANALYSIS_PROMPT.replace('{{profile}}', profileSection)
  const vaultSection = vaultFiles.length > 0
    ? `\nCurrent vault files:\n${vaultFiles.map((f) => `  ${f}`).join('\n')}\n`
    : ''

  let chunks: Chunk[] = []
  try {
    const response = await chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Project: ${req.project}${vaultSection}\nTranscript:\n${transcriptText}` },
    ])
    chunks = parseChunks(response)
  } catch (err) {
    log.error('ingest', 'analysis failed', String(err))
    return { chunks: 0 }
  }

  if (chunks.length === 0) {
    log.info('ingest', 'no knowledge chunks identified')
    return { chunks: 0 }
  }

  log.info('ingest', `identified ${chunks.length} chunk(s) — enqueueing jobs`)

  for (const chunk of chunks) {
    enqueue({ type: 'prune', vault, topic: chunk.topic, excerpt: chunk.excerpt })
  }

  return { chunks: chunks.length }
}

function parseChunks(text: string): Chunk[] {
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
