import { Database } from '@db/sqlite'
import { config } from '../config.ts'
import { log } from '../log.ts'
import type { NoteParams, NoteRecord, SearchParams, SearchResult, Store } from './store.ts'

const DDL = [
  `CREATE TABLE IF NOT EXISTS notes (
    id              TEXT PRIMARY KEY,
    vault           TEXT NOT NULL,
    path            TEXT NOT NULL,
    summary         TEXT,
    projects        TEXT NOT NULL DEFAULT '[]',
    embed       TEXT,
    embed_model TEXT,
    content_hash    TEXT,
    metadata        TEXT NOT NULL DEFAULT '{}',
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (vault, path)
  )`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(id UNINDEXED, vault UNINDEXED, summary, path)`,
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

// Helper: run a prepared query and return rows as typed objects
// deno-lint-ignore no-explicit-any
function q<T>(db: Database, sql: string, ...params: any[]): T[] {
  return [...db.prepare(sql).iter(...params)] as T[]
}

export class SqliteStore implements Store {
  private db: Database

  constructor() {
    this.db = new Database(config.db.sqlitePath)
  }

  init(): Promise<void> {
    log.info('db', `running ${DDL.length} DDL statements (sqlite: ${config.db.sqlitePath})`)
    this.db.exec('PRAGMA journal_mode=WAL')
    this.db.exec('PRAGMA foreign_keys=ON')
    for (const stmt of DDL) this.db.exec(stmt)
    log.info('db', 'sqlite ready')
    return Promise.resolve()
  }

  close(): Promise<void> {
    this.db.close()
    return Promise.resolve()
  }

  upsertNote(p: NoteParams): Promise<void> {
    const vec = p.embed ? JSON.stringify(p.embed) : null
    const projects = JSON.stringify(p.projects)
    const now = new Date().toISOString()

    this.db.prepare(`DELETE FROM notes WHERE vault = ? AND path = ? AND id != ?`).run(p.vault, p.path, p.id)
    this.db.prepare(`DELETE FROM notes_fts WHERE id = ?`).run(p.id)

    this.db.prepare(
      `INSERT INTO notes (id, vault, path, summary, projects, embed, embed_model, content_hash, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         vault           = excluded.vault,
         path            = excluded.path,
         summary         = excluded.summary,
         projects        = excluded.projects,
         embed       = excluded.embed,
         embed_model = excluded.embed_model,
         content_hash    = excluded.content_hash,
         updated_at      = excluded.updated_at`,
    ).run(p.id, p.vault, p.path, p.summary, projects, vec, p.embedModel, p.contentHash, now)

    this.db.prepare(`INSERT INTO notes_fts (id, vault, summary, path) VALUES (?, ?, ?, ?)`).run(
      p.id,
      p.vault,
      p.summary ?? '',
      p.path,
    )
    return Promise.resolve()
  }

  deleteNote(vault: string, path: string): Promise<void> {
    type R = { id: string }
    const row = q<R>(this.db, `SELECT id FROM notes WHERE vault = ? AND path = ?`, vault, path)[0]
    if (row) {
      this.db.prepare(`DELETE FROM notes_fts WHERE id = ?`).run(row.id)
      this.db.prepare(`DELETE FROM notes WHERE vault = ? AND path = ?`).run(vault, path)
    }
    return Promise.resolve()
  }

  getNoteByPath(vault: string, path: string): Promise<NoteRecord | null> {
    type R = {
      id: string
      content_hash: string | null
      embed_model: string | null
      projects: string
    }
    const row = q<R>(
      this.db,
      `SELECT id, content_hash, embed_model, projects FROM notes WHERE vault = ? AND path = ?`,
      vault,
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

  getNoteById(id: string): Promise<{ vault: string; path: string } | null> {
    type R = { vault: string; path: string }
    return Promise.resolve(q<R>(this.db, `SELECT vault, path FROM notes WHERE id = ?`, id)[0] ?? null)
  }

  searchNotes(p: SearchParams): Promise<SearchResult[]> {
    type R = {
      id: string
      path: string
      summary: string | null
      projects: string
      embed: string
    }
    const allRows = q<R>(
      this.db,
      `SELECT id, path, summary, projects, embed FROM notes WHERE vault = ? AND embed IS NOT NULL`,
      p.vault,
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

    const ftsScores = this.getFtsScores(p.vault, p.query, candidates.map((c) => c.id))
    for (const c of candidates) c.score += (1 - (ftsScores.get(c.id) ?? 0)) * p.ftsWeight

    candidates.sort((a, b) => a.score - b.score)
    return Promise.resolve(candidates.slice(0, p.limit))
  }

  searchNotesFts(vault: string, query: string, limit: number): Promise<SearchResult[]> {
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
         WHERE notes_fts MATCH ? AND n.vault = ?
         ORDER BY rank
         LIMIT ${limit}`,
        ftsQuery,
        vault,
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

  getNotesNeedingReindex(currentModel: string): Promise<Array<{ vault: string; path: string }>> {
    type R = { vault: string; path: string }
    return Promise.resolve(
      q<R>(this.db, `SELECT vault, path FROM notes WHERE embed IS NULL OR embed_model IS NOT ?`, currentModel),
    )
  }

  checkDuplicate(vault: string, embed: number[], threshold: number): Promise<boolean> {
    type R = { embed: string }
    const rows = q<R>(this.db, `SELECT embed FROM notes WHERE vault = ? AND embed IS NOT NULL`, vault)
    for (const { embed: embJson } of rows) {
      if ((1 - cosineDistance(embed, JSON.parse(embJson) as number[])) >= threshold) return Promise.resolve(true)
    }
    return Promise.resolve(false)
  }

  resolveNoteTarget(vault: string, target: string): Promise<string | null> {
    type R = { id: string }
    const row = q<R>(
      this.db,
      `SELECT id FROM notes WHERE vault = ? AND (path = ? OR path = ? || '.md' OR path LIKE '%/' || ? || '.md' OR path LIKE '%/' || ?) LIMIT 1`,
      vault,
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

  private getFtsScores(vault: string, query: string, ids: string[]): Map<string, number> {
    const map = new Map<string, number>()
    const ftsQuery = toFts5Query(query)
    if (!ftsQuery || ids.length === 0) return map
    try {
      const placeholders = ids.map(() => '?').join(',')
      type R = { id: string; rank: number }
      const rows = q<R>(
        this.db,
        `SELECT notes_fts.id, bm25(notes_fts) AS rank FROM notes_fts WHERE notes_fts MATCH ? AND vault = ? AND id IN (${placeholders})`,
        ftsQuery,
        vault,
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
