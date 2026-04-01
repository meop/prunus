import { join } from '@std/path'
import { walk } from '@std/fs'

import { config } from './config.ts'
import { getStore } from './db/index.ts'
import { embed } from './llm/embed.ts'
import { runAgent } from './llm/agent.ts'
import { log } from './log.ts'
import { contentHash, extractWikilinks, parseFrontmatter } from './vault/parser.ts'
import { readNote } from './vault/reader.ts'
import { removeSeeAlsoLink } from './vault/see-also.ts'
import { writeNote } from './vault/writer.ts'
import { vaultTools } from './vault/agent-tools.ts'

export type Job =
  | { type: 'reindex'; vault: string; path: string }
  | { type: 'delete'; vault: string; path: string }
  | { type: 'prune'; vault: string; topic: string; excerpt: string }
  | { type: 'shape'; vault: string }

const PRUNE_SYSTEM = `You are updating a developer's knowledge vault named "{{vault}}".

You have one piece of knowledge to integrate. Use the tools to:
1. Search for and read any existing notes that might be related
2. Decide the best action: update an existing note, create a new one, or delete outdated ones
3. Make all necessary changes — including updating links in related notes
4. Call finish() when done

Vault-relative paths only. Lowercase kebab-case. No vault name prefix.
Link to related notes using [[path/to/note]] syntax (no .md extension).`

const SHAPE_SYSTEM = `You are reorganizing a developer's knowledge vault named "{{vault}}".

Review the vault contents and improve its quality:
- Merge notes that cover the same topic
- Delete notes with no lasting value
- Update outdated or thin notes with better content
- Fix or add [[wikilinks]] between related notes

Use the tools to read, write, and delete notes as needed. Work through the vault systematically.
Call finish() when done.`

const pending = new Map<string, Job>()
const queue: string[] = []
let running = 0
const CONCURRENCY = 2

const chunkCounts = new Map<string, number>()
const STATS_PATH = join(config.db.sqliteDir, 'stats.json')

interface Stats {
  prune_count: Record<string, number>
}

async function loadStats(): Promise<void> {
  try {
    const raw = await Deno.readTextFile(STATS_PATH)
    const data = JSON.parse(raw) as Stats
    for (const [vault, count] of Object.entries(data.prune_count ?? {})) chunkCounts.set(vault, count)
    log.debug('queue', `loaded stats: ${JSON.stringify(data)}`)
  } catch { /* file doesn't exist yet */ }
}

async function saveStats(): Promise<void> {
  const stats: Stats = { prune_count: Object.fromEntries(chunkCounts) }
  await Deno.writeTextFile(STATS_PATH, JSON.stringify(stats, null, 2))
}

const drainWaiters: Array<() => void> = []

function jobKey(job: Job): string {
  switch (job.type) {
    case 'shape':
      return `shape:${job.vault}`
    default:
      return `${job.type}:${job.vault}:${'path' in job ? job.path : job.topic}`
  }
}

export function enqueue(job: Job): void {
  const key = jobKey(job)
  const isNew = !pending.has(key)
  pending.set(key, job)
  if (isNew) queue.push(key)
  tick()
}

export function queueDepth(): number {
  return queue.length + running
}

export function drain(): Promise<void> {
  if (running === 0 && queue.length === 0) return Promise.resolve()
  return new Promise((resolve) => drainWaiters.push(resolve))
}

export async function initQueue(): Promise<void> {
  await loadStats()
}

export async function requeueNullEmbeddings(): Promise<void> {
  try {
    const notes = await getStore().getNotesNeedingReindex(config.llm.embedModel)
    if (notes.length > 0) {
      log.info('queue', `re-queuing ${notes.length} note(s) with missing/stale embeddings`)
      for (const { vault, path } of notes) enqueue({ type: 'reindex', vault, path })
    }
  } catch (err) {
    log.warn('queue', 'could not check for stale embeddings', String(err))
  }
}

function tick(): void {
  while (running < CONCURRENCY && queue.length > 0) {
    const key = queue.shift()!
    const job = pending.get(key)
    if (!job) continue
    pending.delete(key)
    running++
    processWithRetry(job).finally(() => {
      running--
      tick()
      if (running === 0 && queue.length === 0 && drainWaiters.length > 0) {
        const waiters = drainWaiters.splice(0)
        for (const resolve of waiters) resolve()
      }
    })
  }
}

async function processWithRetry(job: Job): Promise<void> {
  const label = 'path' in job ? `${job.vault}/${job.path}` : job.vault
  const MAX = 3
  for (let attempt = 1; attempt <= MAX; attempt++) {
    try {
      await processJob(job)
      return
    } catch (err) {
      log.warn('queue', `attempt ${attempt}/${MAX}: ${job.type} ${label}`, String(err))
      if (attempt === MAX) {
        log.error('queue', `giving up: ${job.type} ${label}`)
        return
      }
      await sleep(1000 * Math.pow(2, attempt - 1))
    }
  }
}

async function processJob(job: Job): Promise<void> {
  const store = getStore()

  if (job.type === 'reindex') {
    const { frontmatter: fm, body } = await readNote(job.vault, job.path)
    const hash = contentHash(fm.summary, body)
    const existing = await store.getNoteByPath(job.vault, job.path)
    if (existing?.contentHash === hash && existing.embedModel === config.llm.embedModel) {
      log.debug('queue', `unchanged: ${job.vault}/${job.path}`)
      return
    }
    const vec = await embed(fm.summary || body.slice(0, 500))
    await store.upsertNote({
      vault: job.vault,
      path: job.path,
      id: fm.id,
      summary: fm.summary,
      projects: fm.projects,
      embed: vec,
      embedModel: config.llm.embedModel,
      contentHash: hash,
    })
    const resolved: Array<{ targetId: string; type: string }> = []
    for (const target of extractWikilinks(body)) {
      const targetId = await store.resolveNoteTarget(job.vault, target)
      if (targetId && targetId !== fm.id) resolved.push({ targetId, type: 'wikilink' })
    }
    await store.upsertLinks(fm.id, resolved)
    log.debug('queue', `indexed: ${job.vault}/${job.path}`)
    return
  }

  if (job.type === 'delete') {
    const record = await store.getNoteByPath(job.vault, job.path)
    if (record) {
      const stem = job.path.replace(/\.md$/, '')
      const sources = await store.getSourcesLinkingTo(record.id)
      for (const src of sources) {
        if (src.vault !== job.vault) continue
        try {
          const { frontmatter: fm, body } = await readNote(src.vault, src.path)
          const updated = removeSeeAlsoLink(body, stem)
          if (updated !== body) {
            await writeNote(src.vault, src.path, fm, updated)
            enqueue({ type: 'reindex', vault: src.vault, path: src.path })
            log.debug('queue', `removed stale link to ${stem} in ${src.vault}/${src.path}`)
          }
        } catch (err) {
          log.warn('queue', `stale-link cleanup failed for ${src.vault}/${src.path}`, String(err))
        }
      }
    }
    await store.deleteNote(job.vault, job.path)
    log.debug('queue', `deleted: ${job.vault}/${job.path}`)
    return
  }

  if (job.type === 'prune') {
    if (!config.llm.chatModel) return
    const modified = new Set<string>()
    const deleted = new Set<string>()
    const tools = vaultTools(job.vault, modified, deleted)
    const notes = await readVaultSummaries(job.vault)

    const systemPrompt = PRUNE_SYSTEM.replace(/\{\{vault\}\}/g, job.vault)
    const notesList = notes.map((n) => `  ${n.path}: ${n.summary}`).join('\n')
    const userMessage =
      `Knowledge to integrate:\n${job.topic}\n\nContext from transcript:\n${job.excerpt}\n\nExisting vault notes (path: summary):\n${
        notesList || '  (empty)'
      }`

    await runAgent(systemPrompt, userMessage, tools)

    for (const path of deleted) enqueue({ type: 'delete', vault: job.vault, path })
    for (const path of modified) enqueue({ type: 'reindex', vault: job.vault, path })
    log.info('queue', `prune done: ${modified.size} written, ${deleted.size} deleted`)

    const count = (chunkCounts.get(job.vault) ?? 0) + 1
    chunkCounts.set(job.vault, count)
    await saveStats()
    if (count % config.vault.shapeInterval === 0) {
      log.info('queue', `shape triggered after ${count} chunks for vault=${job.vault}`)
      enqueue({ type: 'shape', vault: job.vault })
    }
    return
  }

  if (job.type === 'shape') {
    if (!config.llm.chatModel) return
    const modified = new Set<string>()
    const deleted = new Set<string>()
    const tools = vaultTools(job.vault, modified, deleted)
    const notes = await readVaultSummaries(job.vault)
    if (notes.length === 0) return

    const systemPrompt = SHAPE_SYSTEM.replace(/\{\{vault\}\}/g, job.vault)
    const notesList = notes.map((n) => `  ${n.path}: ${n.summary}`).join('\n')
    const userMessage = `Vault contents:\n${notesList}`

    await runAgent(systemPrompt, userMessage, tools, 20)

    for (const path of deleted) enqueue({ type: 'delete', vault: job.vault, path })
    for (const path of modified) enqueue({ type: 'reindex', vault: job.vault, path })
    log.info('queue', `shape done: ${modified.size} written, ${deleted.size} deleted`)
    return
  }
}

async function readVaultSummaries(vault: string): Promise<Array<{ path: string; summary: string }>> {
  const base = join(config.vault.base, vault)
  const notes: Array<{ path: string; summary: string }> = []
  try {
    for await (const entry of walk(base, { exts: ['.md'], includeDirs: false })) {
      const path = entry.path.slice(base.length + 1)
      try {
        const raw = await Deno.readTextFile(entry.path)
        const { frontmatter: fm } = parseFrontmatter(raw)
        notes.push({ path, summary: fm.summary })
      } catch { /* skip unreadable */ }
    }
  } catch { /* vault doesn't exist yet */ }
  return notes.sort((a, b) => a.path.localeCompare(b.path))
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
