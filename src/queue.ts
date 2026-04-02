import { walk } from '@std/fs'
import { join } from '@std/path'

import { SETTINGS } from './stng.ts'
import { getStore } from './db/index.ts'
import { runAgent } from './llm/agent.ts'
import { embed } from './llm/embed.ts'
import { log } from './log.ts'
import { contentHash, extractWikilinks, parseFrontmatter } from './tree/parser.ts'
import { readNote } from './tree/reader.ts'
import { removeSeeAlsoLink } from './tree/related.ts'
import { treeTools } from './tree/tools.ts'
import { writeNote } from './tree/writer.ts'

export type Job =
  | { type: 'survey'; tree: string; path: string }
  | { type: 'grow'; tree: string; topic: string; excerpt: string }
  | { type: 'heal'; tree: string; changedPath: string; summary: string; change: 'modified' | 'deleted' }
  | { type: 'prune'; tree: string; path: string; triggerHeal?: boolean }
  | { type: 'shape'; tree: string }

const GROW_SYSTEM = `You are updating a developer's knowledge tree named "{{tree}}".

You have one piece of knowledge to integrate. Use the tools to:
1. Search for and read any existing notes that might be related
2. Decide the best action: update an existing note, create a new one, or delete outdated ones
3. Make all necessary changes — including updating links in related notes
4. Call finish() when done

Tree-relative paths only. Lowercase kebab-case. No tree name prefix.
Link to related notes using [[path/to/note]] syntax (no .md extension).`

const HEAL_SYSTEM = `You are reviewing a developer's knowledge tree named "{{tree}}" after a note change.

The note "{{path}}" was {{change}}. Its topic: {{summary}}

Use the tools to:
1. Search for notes related to this topic
2. Read and update any that reference outdated information, contain stale links, or should reflect this change
3. Call finish() when done — if nothing needs updating, just call finish()`

const SHAPE_SYSTEM = `You are reorganizing a developer's knowledge tree named "{{tree}}".

Review the tree contents and improve its quality:
- Merge notes that cover the same topic
- Delete notes with no lasting value
- Update outdated or thin notes with better content
- Fix or add [[wikilinks]] between related notes

Use the tools to read, write, and delete notes as needed. Work through the tree systematically.
Call finish() when done.`

const pending = new Map<string, Job>()
const queue: string[] = []
let running = 0
const CONCURRENCY = 2

const chunkCounts = new Map<string, number>()
const STATS_PATH = join(SETTINGS.db.sqlite.path, 'stats.json')

interface Stats {
  grow_count: Record<string, number>
}

async function loadStats(): Promise<void> {
  try {
    const raw = await Deno.readTextFile(STATS_PATH)
    const data = JSON.parse(raw) as Stats
    for (const [tree, count] of Object.entries(data.grow_count ?? {})) chunkCounts.set(tree, count)
    log.debug('queue', `loaded stats: ${JSON.stringify(data)}`)
  } catch { /* file doesn't exist yet */ }
}

async function saveStats(): Promise<void> {
  const stats: Stats = { grow_count: Object.fromEntries(chunkCounts) }
  await Deno.writeTextFile(STATS_PATH, JSON.stringify(stats, null, 2))
}

const drainWaiters: Array<() => void> = []

function jobKey(job: Job): string {
  switch (job.type) {
    case 'shape':
      return `shape:${job.tree}`
    case 'heal':
      return `heal:${job.tree}:${job.changedPath}`
    case 'grow':
      return `grow:${job.tree}:${job.topic}`
    default:
      return `${job.type}:${job.tree}:${job.path}`
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

export async function surveyStaleNotes(): Promise<void> {
  try {
    const notes = await getStore().getNotesNeedingReindex(SETTINGS.llm.embed.model)
    if (notes.length > 0) {
      log.info('queue', `re-queuing ${notes.length} note(s) with missing/stale embeddings`)
      for (const { tree, path } of notes) enqueue({ type: 'survey', tree, path })
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
  const label = 'path' in job
    ? `${job.tree}/${job.path}`
    : 'changedPath' in job
    ? `${job.tree}/${job.changedPath}`
    : job.tree
  const MAX = 5
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
      await sleep(5000 * Math.pow(2, attempt - 1))
    }
  }
}

async function processJob(job: Job): Promise<void> {
  const store = getStore()

  if (job.type === 'survey') {
    const { frontmatter: fm, body } = await readNote(job.tree, job.path)
    const hash = contentHash(fm.summary, body)
    const existing = await store.getNoteByPath(job.tree, job.path)
    if (existing?.contentHash === hash && existing.embedModel === SETTINGS.llm.embed.model) {
      log.debug('queue', `unchanged: ${job.tree}/${job.path}`)
      return
    }
    const vec = await embed(fm.summary || body.slice(0, 500))
    await store.upsertNote({
      tree: job.tree,
      path: job.path,
      id: fm.id,
      summary: fm.summary,
      projects: fm.projects,
      embed: vec,
      embedModel: SETTINGS.llm.embed.model,
      contentHash: hash,
    })
    const resolved: Array<{ targetId: string; type: string }> = []
    for (const target of extractWikilinks(body)) {
      const targetId = await store.resolveNoteTarget(job.tree, target)
      if (targetId && targetId !== fm.id) resolved.push({ targetId, type: 'wikilink' })
    }
    await store.upsertLinks(fm.id, resolved)
    log.debug('queue', `indexed: ${job.tree}/${job.path}`)
    return
  }

  // Cascade: prune(triggerHeal) → heal. prune(no flag) → stops here.
  if (job.type === 'prune') {
    const record = await store.getNoteByPath(job.tree, job.path)
    if (record) {
      const stem = job.path.replace(/\.md$/, '')
      const sources = await store.getSourcesLinkingTo(record.id)
      for (const src of sources) {
        if (src.tree !== job.tree) continue
        try {
          const { frontmatter: fm, body } = await readNote(src.tree, src.path)
          const updated = removeSeeAlsoLink(body, stem)
          if (updated !== body) {
            await writeNote(src.tree, src.path, fm, updated)
            enqueue({ type: 'survey', tree: src.tree, path: src.path })
            log.debug('queue', `removed stale link to ${stem} in ${src.tree}/${src.path}`)
          }
        } catch (err) {
          log.warn('queue', `stale-link cleanup failed for ${src.tree}/${src.path}`, String(err))
        }
      }
      if (job.triggerHeal) {
        enqueue({ type: 'heal', tree: job.tree, changedPath: job.path, summary: stem, change: 'deleted' })
      }
    }
    await store.deleteNote(job.tree, job.path)
    log.debug('queue', `pruned: ${job.tree}/${job.path}`)
    return
  }

  if (job.type === 'grow') {
    if (!SETTINGS.llm.chat.model) return
    const modified = new Set<string>()
    const deleted = new Set<string>()
    const tools = treeTools(job.tree, modified, deleted)
    const notes = await readTreeSummaries(job.tree)

    const systemPrompt = GROW_SYSTEM.replace(/\{\{tree\}\}/g, job.tree)
    const notesList = notes.map((n) => `  ${n.path}: ${n.summary}`).join('\n')
    const userMessage =
      `Knowledge to integrate:\n${job.topic}\n\nContext from transcript:\n${job.excerpt}\n\nExisting tree notes (path: summary):\n${
        notesList || '  (empty)'
      }`

    await runAgent(systemPrompt, userMessage, tools)

    // grow outputs: survey modified, prune deleted — no triggerHeal (grow handles its own ripple)
    for (const path of deleted) enqueue({ type: 'prune', tree: job.tree, path })
    for (const path of modified) enqueue({ type: 'survey', tree: job.tree, path })
    log.info('queue', `grow [${job.tree}] done: ${modified.size} written, ${deleted.size} deleted`)

    const count = (chunkCounts.get(job.tree) ?? 0) + 1
    chunkCounts.set(job.tree, count)
    await saveStats()
    if (count % SETTINGS.grove.shape.interval === 0) {
      log.info('queue', `shape [${job.tree}] triggered after ${count} chunks`)
      enqueue({ type: 'shape', tree: job.tree })
    }
    return
  }

  if (job.type === 'shape') {
    if (!SETTINGS.llm.chat.model) return
    const modified = new Set<string>()
    const deleted = new Set<string>()
    const tools = treeTools(job.tree, modified, deleted)
    const notes = await readTreeSummaries(job.tree)
    if (notes.length === 0) return

    const systemPrompt = SHAPE_SYSTEM.replace(/\{\{tree\}\}/g, job.tree)
    const notesList = notes.map((n) => `  ${n.path}: ${n.summary}`).join('\n')
    const userMessage = `Tree contents:\n${notesList}`

    await runAgent(systemPrompt, userMessage, tools, 20)

    // shape outputs: survey modified, prune deleted — no triggerHeal (shape handles its own ripple)
    for (const path of deleted) enqueue({ type: 'prune', tree: job.tree, path })
    for (const path of modified) enqueue({ type: 'survey', tree: job.tree, path })
    log.info('queue', `shape [${job.tree}] done: ${modified.size} written, ${deleted.size} deleted`)
    return
  }

  // Cascade: heal → survey modified, prune deleted (no triggerHeal — heal does not re-trigger heal).
  // Re-entry can only happen via the watcher seeing heal's file writes, which is bounded by job dedup.
  if (job.type === 'heal') {
    if (!SETTINGS.llm.chat.model) return
    const modified = new Set<string>()
    const deleted = new Set<string>()
    const tools = treeTools(job.tree, modified, deleted)

    const systemPrompt = HEAL_SYSTEM
      .replace(/\{\{tree\}\}/g, job.tree)
      .replace(/\{\{path\}\}/g, job.changedPath)
      .replace(/\{\{change\}\}/g, job.change)
      .replace(/\{\{summary\}\}/g, job.summary)
    const userMessage = `Review notes related to: ${job.summary}`

    await runAgent(systemPrompt, userMessage, tools)

    for (const path of deleted) enqueue({ type: 'prune', tree: job.tree, path })
    for (const path of modified) enqueue({ type: 'survey', tree: job.tree, path })
    log.info('queue', `heal [${job.tree}] done (${job.change}): ${modified.size} written, ${deleted.size} deleted`)
    return
  }
}

async function readTreeSummaries(tree: string): Promise<Array<{ path: string; summary: string }>> {
  const base = join(SETTINGS.grove.path, tree)
  const notes: Array<{ path: string; summary: string }> = []
  try {
    for await (const entry of walk(base, { exts: ['.md'], includeDirs: false, skip: [/\/\.profiles(\/|$)/] })) {
      const path = entry.path.slice(base.length + 1)
      try {
        const raw = await Deno.readTextFile(entry.path)
        const { frontmatter: fm } = parseFrontmatter(raw)
        notes.push({ path, summary: fm.summary })
      } catch { /* skip unreadable */ }
    }
  } catch { /* tree doesn't exist yet */ }
  return notes.sort((a, b) => a.path.localeCompare(b.path))
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
