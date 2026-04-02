import { Database } from '@db/sqlite'
import { join } from '@std/path'

import { SETTINGS } from '../stng.ts'
import { log } from '../log.ts'
import type { NoteParams, NoteRecord, SearchParams, SearchResult, Store } from './store.ts'

const SQLITE_VEC_VERSION = '0.1.9'

function platformSlug(): string {
  const os = Deno.build.os === 'darwin' ? 'macos' : Deno.build.os
  const arch = Deno.build.arch
  return `${os}-${arch}`
}

function vecFileName(): string {
  if (Deno.build.os === 'windows') return 'vec0.dll'
  if (Deno.build.os === 'darwin') return 'vec0.dylib'
  return 'vec0.so'
}

async function ensureVecExtension(dir: string): Promise<string | null> {
  const name = vecFileName()
  const extPath = join(dir, name)

  try {
    await Deno.stat(extPath)
    return extPath
  } catch { /* not cached */ }

  const slug = platformSlug()
  const archive = `sqlite-vec-${SQLITE_VEC_VERSION}-loadable-${slug}.tar.gz`
  const url = `https://github.com/asg017/sqlite-vec/releases/download/v${SQLITE_VEC_VERSION}/${archive}`

  log.info('db', `downloading sqlite-vec ${SQLITE_VEC_VERSION} (${slug})`)

  const resp = await fetch(url)
  if (!resp.ok) {
    log.warn('db', `failed to download sqlite-vec: ${resp.status} ${resp.statusText}`)
    return null
  }

  await Deno.mkdir(dir, { recursive: true })

  const archivePath = join(dir, archive)
  try {
    await Deno.writeFile(archivePath, new Uint8Array(await resp.arrayBuffer()))
    const { code } = await new Deno.Command('tar', { args: ['xzf', archivePath], cwd: dir }).output()
    if (code !== 0) {
      log.warn('db', 'failed to extract sqlite-vec archive')
      return null
    }
    for await (const entry of Deno.readDir(dir)) {
      if (entry.name.startsWith('vec0.')) {
        log.info('db', `sqlite-vec cached at ${join(dir, entry.name)}`)
        return join(dir, entry.name)
      }
    }
    log.warn('db', 'vec0 extension not found in archive')
    return null
  } catch (err) {
    log.warn('db', `sqlite-vec setup failed: ${String(err)}`)
    return null
  } finally {
    await Deno.remove(archivePath).catch(() => {})
  }
}

const DDL = [
  `CREATE TABLE IF NOT EXISTS notes (
    id              TEXT PRIMARY KEY,
    tree           TEXT NOT NULL,
    path            TEXT NOT NULL,
    summary         TEXT,
    projects        TEXT NOT NULL DEFAULT '[]',
    embed       TEXT,
    embed_model TEXT,
    content_hash    TEXT,
    metadata        TEXT NOT NULL DEFAULT '{}',
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (tree, path)
  )`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(id UNINDEXED, tree UNINDEXED, summary, path)`,
  `CREATE TABLE IF NOT EXISTS links (
    source_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    target_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    type      TEXT NOT NULL DEFAULT 'wikilink',
    PRIMARY KEY (source_id, target_id, type)
  )`,
]

function toFts5Query(query: string): string {
  const words = query.trim().split(/\s+/).filter((w) => w.length > 1)
  if (words.length === 0) return ''
  return words.map((w) => `"${w.replace(/"/g, '""')}"`).join(' ')
}

function cosineDistance(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const mag = Math.sqrt(magA) * Math.sqrt(magB)
  return mag === 0 ? 1 : 1 - dot / mag
}

function serializeF32(vec: number[]): Uint8Array {
  const buf = new Uint8Array(vec.length * 4)
  const view = new DataView(buf.buffer)
  for (let i = 0; i < vec.length; i++) view.setFloat32(i * 4, vec[i])
  return buf
}

// deno-lint-ignore no-explicit-any
function q<T>(db: Database, sql: string, ...params: any[]): T[] {
  return [...db.prepare(sql).iter(...params)] as T[]
}

export class SqliteStore implements Store {
  private db!: Database
  private hasVec = false
  private dir: string

  constructor() {
    this.dir = SETTINGS.db.sqlite.path
  }

  async init(): Promise<void> {
    await Deno.mkdir(this.dir, { recursive: true })
    this.db = new Database(join(this.dir, 'prunus.db'))
    log.info('db', `running ${DDL.length} DDL statements (sqlite: ${this.dir})`)
    this.db.exec('PRAGMA journal_mode=WAL')
    this.db.exec('PRAGMA foreign_keys=ON')
    for (const stmt of DDL) this.db.exec(stmt)

    const vecPath = await ensureVecExtension(this.dir)
    if (vecPath) {
      try {
        this.db.enableLoadExtension = true
        this.db.loadExtension(vecPath)
        this.db.enableLoadExtension = false
        this.hasVec = true
        this.db.exec(
          `CREATE VIRTUAL TABLE IF NOT EXISTS notes_vec USING vec0(note_id TEXT PRIMARY KEY, embedding float[${SETTINGS.llm.embed.dimension}])`,
        )
        log.info('db', 'sqlite-vec extension loaded')
      } catch (err) {
        this.db.enableLoadExtension = false
        log.warn('db', `failed to load sqlite-vec: ${String(err)}, falling back to JS cosine`)
      }
    } else {
      log.info('db', 'sqlite-vec not available, using JS cosine similarity')
    }

    log.info('db', 'sqlite ready')
  }

  close(): Promise<void> {
    this.db.close()
    return Promise.resolve()
  }

  upsertNote(p: NoteParams): Promise<void> {
    const vec = p.embed ? JSON.stringify(p.embed) : null
    const projects = JSON.stringify(p.projects)
    const now = new Date().toISOString()

    this.db.prepare(`DELETE FROM notes WHERE tree = ? AND path = ? AND id != ?`).run(p.tree, p.path, p.id)
    this.db.prepare(`DELETE FROM notes_fts WHERE id = ?`).run(p.id)

    this.db.prepare(
      `INSERT INTO notes (id, tree, path, summary, projects, embed, embed_model, content_hash, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         tree           = excluded.tree,
         path            = excluded.path,
         summary         = excluded.summary,
         projects        = excluded.projects,
         embed       = excluded.embed,
         embed_model = excluded.embed_model,
         content_hash    = excluded.content_hash,
         updated_at      = excluded.updated_at`,
    ).run(p.id, p.tree, p.path, p.summary, projects, vec, p.embedModel, p.contentHash, now)

    this.db.prepare(`INSERT INTO notes_fts (id, tree, summary, path) VALUES (?, ?, ?, ?)`).run(
      p.id,
      p.tree,
      p.summary ?? '',
      p.path,
    )

    if (this.hasVec) {
      this.db.prepare(`DELETE FROM notes_vec WHERE note_id = ?`).run(p.id)
      if (p.embed) {
        this.db.prepare(`INSERT INTO notes_vec (note_id, embedding) VALUES (?, ?)`).run(
          p.id,
          serializeF32(p.embed),
        )
      }
    }

    return Promise.resolve()
  }

  deleteNote(tree: string, path: string): Promise<void> {
    type R = { id: string }
    const row = q<R>(this.db, `SELECT id FROM notes WHERE tree = ? AND path = ?`, tree, path)[0]
    if (row) {
      this.db.prepare(`DELETE FROM notes_fts WHERE id = ?`).run(row.id)
      if (this.hasVec) this.db.prepare(`DELETE FROM notes_vec WHERE note_id = ?`).run(row.id)
      this.db.prepare(`DELETE FROM notes WHERE tree = ? AND path = ?`).run(tree, path)
    }
    return Promise.resolve()
  }

  getNoteByPath(tree: string, path: string): Promise<NoteRecord | null> {
    type R = {
      id: string
      content_hash: string | null
      embed_model: string | null
      projects: string
    }
    const row = q<R>(
      this.db,
      `SELECT id, content_hash, embed_model, projects FROM notes WHERE tree = ? AND path = ?`,
      tree,
      path,
    )[0]
    if (!row) return Promise.resolve(null)
    return Promise.resolve({
      id: row.id,
      contentHash: row.content_hash,
      embedModel: row.embed_model,
      projects: JSON.parse(row.projects),
    })
  }

  getNoteById(id: string): Promise<{ tree: string; path: string } | null> {
    type R = { tree: string; path: string }
    return Promise.resolve(q<R>(this.db, `SELECT tree, path FROM notes WHERE id = ?`, id)[0] ?? null)
  }

  searchNotes(p: SearchParams): Promise<SearchResult[]> {
    if (this.hasVec) return this.searchNotesVector(p)
    return this.searchNotesCosine(p)
  }

  private searchNotesVector(p: SearchParams): Promise<SearchResult[]> {
    type R = { note_id: string; distance: number }
    const vecRows = q<R>(
      this.db,
      `SELECT note_id, distance FROM notes_vec WHERE embedding MATCH ? ORDER BY distance LIMIT ?`,
      serializeF32(p.queryEmbedding),
      p.limit * 3,
    )
    if (vecRows.length === 0) return Promise.resolve([])

    const ids = vecRows.map((r) => r.note_id)
    const placeholders = ids.map(() => '?').join(',')
    type N = { id: string; path: string; summary: string | null; projects: string; tree: string }
    const notes = q<N>(
      this.db,
      `SELECT id, tree, path, summary, projects FROM notes WHERE tree = ? AND id IN (${placeholders})`,
      p.tree,
      ...ids,
    )

    const distMap = new Map(vecRows.map((r) => [r.note_id, r.distance]))
    type Candidate = SearchResult & { distance: number }
    const candidates: Candidate[] = []
    for (const n of notes) {
      const distance = distMap.get(n.id)
      if (distance === undefined || distance >= p.vectorGate) continue
      candidates.push({
        id: n.id,
        path: n.path,
        summary: n.summary ?? '',
        projects: JSON.parse(n.projects),
        score: distance * p.vectorWeight,
        distance,
      })
    }

    if (candidates.length === 0) return Promise.resolve([])

    const ftsScores = this.getFtsScores(p.tree, p.query, candidates.map((c) => c.id))
    for (const c of candidates) c.score += (1 - (ftsScores.get(c.id) ?? 0)) * p.ftsWeight

    candidates.sort((a, b) => a.score - b.score)
    return Promise.resolve(candidates.slice(0, p.limit))
  }

  private searchNotesCosine(p: SearchParams): Promise<SearchResult[]> {
    type R = {
      id: string
      path: string
      summary: string | null
      projects: string
      embed: string
    }
    const allRows = q<R>(
      this.db,
      `SELECT id, path, summary, projects, embed FROM notes WHERE tree = ? AND embed IS NOT NULL`,
      p.tree,
    )

    type Candidate = SearchResult & { distance: number }
    const candidates: Candidate[] = []

    for (const row of allRows) {
      const projects: string[] = JSON.parse(row.projects)
      const distance = cosineDistance(p.queryEmbedding, JSON.parse(row.embed) as number[])
      if (distance >= p.vectorGate) continue
      candidates.push({
        id: row.id,
        path: row.path,
        summary: row.summary ?? '',
        projects,
        score: distance * p.vectorWeight,
        distance,
      })
    }

    if (candidates.length === 0) return Promise.resolve([])

    const ftsScores = this.getFtsScores(p.tree, p.query, candidates.map((c) => c.id))
    for (const c of candidates) c.score += (1 - (ftsScores.get(c.id) ?? 0)) * p.ftsWeight

    candidates.sort((a, b) => a.score - b.score)
    return Promise.resolve(candidates.slice(0, p.limit))
  }

  searchNotesFts(tree: string, query: string, limit: number): Promise<SearchResult[]> {
    const ftsQuery = toFts5Query(query)
    if (!ftsQuery) return Promise.resolve([])
    try {
      type R = {
        id: string
        path: string
        summary: string | null
        projects: string
        rank: number
      }
      const rows = q<R>(
        this.db,
        `SELECT n.id, n.path, n.summary, n.projects, bm25(notes_fts) AS rank
         FROM notes_fts
         JOIN notes n ON notes_fts.id = n.id
         WHERE notes_fts MATCH ? AND n.tree = ?
         ORDER BY rank
         LIMIT ${limit}`,
        ftsQuery,
        tree,
      )
      return Promise.resolve(
        rows
          .map((r) => ({
            id: r.id,
            path: r.path,
            summary: r.summary ?? '',
            projects: JSON.parse(r.projects),
            score: 1 / (1 - r.rank),
          })),
      )
    } catch (_e) {
      return Promise.resolve([])
    }
  }

  getNotesNeedingSurvey(currentModel: string): Promise<Array<{ tree: string; path: string }>> {
    type R = { tree: string; path: string }
    return Promise.resolve(
      q<R>(this.db, `SELECT tree, path FROM notes WHERE embed IS NULL OR embed_model IS NOT ?`, currentModel),
    )
  }

  checkDuplicate(tree: string, embed: number[], threshold: number): Promise<boolean> {
    if (this.hasVec) return this.checkDuplicateVec(tree, embed, threshold)
    return this.checkDuplicateJs(tree, embed, threshold)
  }

  private checkDuplicateVec(tree: string, embed: number[], threshold: number): Promise<boolean> {
    const distance = 1 - threshold
    type R = { note_id: string }
    const match = q<R>(
      this.db,
      `SELECT n.id as note_id FROM notes_vec v JOIN notes n ON v.note_id = n.id
       WHERE v.embedding MATCH ? AND n.tree = ? AND v.distance < ?
       LIMIT 1`,
      serializeF32(embed),
      tree,
      distance,
    )
    return Promise.resolve(match.length > 0)
  }

  private checkDuplicateJs(tree: string, embed: number[], threshold: number): Promise<boolean> {
    type R = { embed: string }
    const rows = q<R>(this.db, `SELECT embed FROM notes WHERE tree = ? AND embed IS NOT NULL`, tree)
    for (const { embed: embJson } of rows) {
      if ((1 - cosineDistance(embed, JSON.parse(embJson) as number[])) >= threshold) return Promise.resolve(true)
    }
    return Promise.resolve(false)
  }

  resolveNoteTarget(tree: string, target: string): Promise<string | null> {
    type R = { id: string }
    const row = q<R>(
      this.db,
      `SELECT id FROM notes WHERE tree = ? AND (path = ? OR path = ? || '.md' OR path LIKE '%/' || ? || '.md' OR path LIKE '%/' || ?) LIMIT 1`,
      tree,
      target,
      target,
      target,
      target,
    )[0]
    return Promise.resolve(row?.id ?? null)
  }

  upsertLinks(sourceId: string, targets: Array<{ targetId: string; type: string }>): Promise<void> {
    this.db.prepare(`DELETE FROM links WHERE source_id = ?`).run(sourceId)
    for (const { targetId, type } of targets) {
      this.db.prepare(`INSERT INTO links (source_id, target_id, type) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`).run(
        sourceId,
        targetId,
        type,
      )
    }
    return Promise.resolve()
  }

  getNoteEmbed(tree: string, path: string): Promise<number[] | null> {
    type R = { embed: string | null }
    const row = q<R>(this.db, `SELECT embed FROM notes WHERE tree = ? AND path = ?`, tree, path)[0]
    if (!row?.embed) return Promise.resolve(null)
    return Promise.resolve(JSON.parse(row.embed) as number[])
  }

  getSourcesLinkingTo(targetId: string): Promise<Array<{ id: string; tree: string; path: string }>> {
    type R = { id: string; tree: string; path: string }
    return Promise.resolve(
      q<R>(
        this.db,
        `SELECT n.id, n.tree, n.path FROM links l JOIN notes n ON l.source_id = n.id WHERE l.target_id = ?`,
        targetId,
      ),
    )
  }

  private getFtsScores(tree: string, query: string, ids: string[]): Map<string, number> {
    const map = new Map<string, number>()
    const ftsQuery = toFts5Query(query)
    if (!ftsQuery || ids.length === 0) return map
    try {
      const placeholders = ids.map(() => '?').join(',')
      type R = { id: string; rank: number }
      const rows = q<R>(
        this.db,
        `SELECT notes_fts.id, bm25(notes_fts) AS rank FROM notes_fts WHERE notes_fts MATCH ? AND tree = ? AND id IN (${placeholders})`,
        ftsQuery,
        tree,
        ...ids,
      )
      if (rows.length === 0) return map
      const scores = rows.map((r) => r.rank)
      const min = Math.min(...scores), max = Math.max(...scores), range = max - min || 1
      for (const { id, rank } of rows) map.set(id, (max - rank) / range)
    } catch (_e) { /* invalid fts query */ }
    return map
  }
}
