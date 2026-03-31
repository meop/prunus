import { join } from '@std/path'
import { config } from '../config.ts'
import { getStore } from '../db/index.ts'
import { enqueue } from '../queue.ts'
import { chat } from '../llm/chat.ts'
import { embed } from '../llm/embed.ts'
import { log } from '../log.ts'
import { commitBatch } from '../vault/git.ts'
import { emptyFrontmatter, parseFrontmatter } from '../vault/parser.ts'
import { loadProfile } from '../vault/profiles.ts'
import { writeNote } from '../vault/writer.ts'

export interface TranscriptEntry {
  role: 'user' | 'assistant'
  content: string
  ts?: string
}

export interface IngestRequest {
  project: string
  transcript: TranscriptEntry[]
  since?: string // ISO timestamp — only process entries after this point
  profile?: string // name of capture profile to use (e.g. "software-architect")
}

export interface IngestResult {
  saved: Array<{ path: string; summary: string }>
  skipped: number
}

interface Note {
  filename: string
  summary: string
  content: string
  tags: string[]
}

const SYSTEM_PROMPT = `You are a knowledge extraction assistant for a developer's personal vault.
{{profile}}
Your task: analyze the conversation transcript below and extract 0-5 insights worth saving as reusable notes.

Focus on: solutions to specific problems, reusable patterns, architecture decisions, gotchas, configuration details.
Skip: small talk, exploratory dead ends, obvious things, one-off project-specific business logic.

Respond with ONLY a JSON array (empty array if nothing is worth saving):
[
  {
    "filename": "category/descriptive-name.md",
    "summary": "2-3 sentence summary for search indexing. Be specific.",
    "content": "Full markdown content. Include code, commands, caveats. Be detailed enough to be useful later.",
    "tags": ["tag1", "tag2"]
  }
]`

export async function ingest(vault: string, req: IngestRequest): Promise<IngestResult> {
  if (!config.llm.chatModel) {
    log.warn('ingest', 'llm.chat.model not set — skipping extraction')
    return { saved: [], skipped: 0 }
  }

  // Filter transcript to entries since the last ingest (for PreCompact deduplication)
  let entries = req.transcript
  if (req.since) {
    const since = new Date(req.since).getTime()
    entries = entries.filter((e) => !e.ts || new Date(e.ts).getTime() > since)
  }

  if (entries.length < 2) return { saved: [], skipped: 0 }

  const profile = await loadProfile(vault, req.profile ?? '')
  const transcriptText = entries.map((e) => `${e.role.toUpperCase()}: ${e.content}`).join('\n\n')

  log.info('ingest', `extracting from ${entries.length} turns for vault=${vault} project=${req.project}`)

  let notes: Note[] = []
  try {
    const profileSection = profile ? `\nVAULT PROFILE (what to capture and what to skip):\n${profile}\n` : ''
    const systemPrompt = SYSTEM_PROMPT.replace('{{profile}}', profileSection)
    const response = await chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Project: ${req.project}\n\nTranscript:\n${transcriptText}` },
    ])
    notes = parseNotes(response)
  } catch (err) {
    log.error('ingest', 'LLM extraction failed', String(err))
    return { saved: [], skipped: 0 }
  }

  if (notes.length === 0) {
    log.info('ingest', 'no notes extracted')
    return { saved: [], skipped: 0 }
  }

  log.info('ingest', `extracted ${notes.length} candidate(s)`)

  const store = getStore()
  const saved: Array<{ path: string; summary: string }> = []
  let skipped = 0

  for (const note of notes) {
    if (!note.filename || !note.summary || !note.content) continue

    // Dedup check
    try {
      const noteEmbed = await embed(note.summary)
      const isDup = await store.checkDuplicate(vault, noteEmbed, config.search.dedupThreshold)
      if (isDup) {
        log.debug('ingest', `duplicate skipped: ${note.filename}`)
        skipped++
        continue
      }
    } catch (err) {
      log.warn('ingest', `dedup check failed for ${note.filename} — saving anyway`, String(err))
    }

    // Read existing note if it exists (to preserve frontmatter)
    const vaultFilePath = join(config.vault.base, vault, note.filename)
    let fm = emptyFrontmatter()
    try {
      const existing = await Deno.readTextFile(vaultFilePath)
      const parsed = parseFrontmatter(existing)
      fm = {
        ...parsed.frontmatter,
        summary: note.summary,
        updated: new Date().toISOString(),
        projects: [...new Set([...parsed.frontmatter.projects, req.project])],
        tags: note.tags ?? parsed.frontmatter.tags,
      }
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) {
        throw e
      }
      fm = {
        ...fm,
        summary: note.summary,
        projects: [req.project],
        tags: note.tags ?? [],
      }
    }

    await writeNote(vault, note.filename, fm, note.content)
    enqueue({ type: 'reindex', vault, path: note.filename })
    saved.push({ path: note.filename, summary: note.summary })
    log.info('ingest', `saved: ${vault}/${note.filename}`)
  }

  if (saved.length > 0) {
    const vaultPath = join(config.vault.base, vault)
    const msg = `ingest: ${saved.length} note(s) from ${req.project}`
    await commitBatch(vaultPath, saved.map((s) => s.path), msg)
  }

  return { saved, skipped }
}

function parseNotes(text: string): Note[] {
  // Extract JSON array from response (model may wrap it in markdown code blocks)
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) return []
  try {
    const parsed = JSON.parse(match[0])
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is Note =>
      typeof x === 'object' && x !== null &&
      typeof x.filename === 'string' &&
      typeof x.summary === 'string' &&
      typeof x.content === 'string'
    )
  } catch (_e) {
    return []
  }
}
