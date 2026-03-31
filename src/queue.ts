import { config } from './config.ts'
import { log } from './log.ts'
import { embed } from './llm/embed.ts'
import { readNote } from './vault/reader.ts'
import { contentHash, extractWikilinks } from './vault/parser.ts'
import { getStore } from './db/index.ts'

export type Job = { type: 'reindex' | 'delete'; vault: string; path: string }

const pending = new Map<string, Job>() // keyed by `vault:path`
const queue: string[] = []
let running = 0
const CONCURRENCY = 2

const drainWaiters: Array<() => void> = []

export function enqueue(job: Job): void {
  const key = `${job.vault}:${job.path}`
  const isNew = !pending.has(key)
  pending.set(key, job) // newer job replaces pending (dedup)
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
  const MAX = 3
  for (let attempt = 1; attempt <= MAX; attempt++) {
    try {
      await processJob(job)
      return
    } catch (err) {
      log.warn('queue', `attempt ${attempt}/${MAX}: ${job.vault}/${job.path}`, String(err))
      if (attempt === MAX) {
        log.error('queue', `giving up: ${job.vault}/${job.path}`)
        return
      }
      await sleep(1000 * Math.pow(2, attempt - 1))
    }
  }
}

async function processJob(job: Job): Promise<void> {
  const store = getStore()

  if (job.type === 'delete') {
    await store.deleteNote(job.vault, job.path)
    log.debug('queue', `deleted: ${job.vault}/${job.path}`)
    return
  }

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

  // Resolve and upsert wikilinks
  const resolved: Array<{ targetId: string; type: string }> = []
  for (const target of extractWikilinks(body)) {
    const targetId = await store.resolveNoteTarget(job.vault, target)
    if (targetId && targetId !== fm.id) resolved.push({ targetId, type: 'wikilink' })
  }
  await store.upsertLinks(fm.id, resolved)

  log.debug('queue', `indexed: ${job.vault}/${job.path}`)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
