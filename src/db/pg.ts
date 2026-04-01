import { Pool } from '@db/postgres'
import { config } from '../config.ts'
import { log } from '../log.ts'
import type { NoteParams, NoteRecord, SearchParams, SearchResult, Store } from './store.ts'

const DDL = [
  `CREATE EXTENSION IF NOT EXISTS vector`,
  `CREATE TABLE IF NOT EXISTS notes (
    id               UUID         PRIMARY KEY,
    vault            TEXT         NOT NULL,
    path             TEXT         NOT NULL,
    summary          TEXT,
    projects         TEXT[]       NOT NULL DEFAULT '{}',
    embed        VECTOR(${config.llm.embedDimension}),
    embed_model  TEXT,
    content_hash     TEXT,
    fts              TSVECTOR     GENERATED ALWAYS AS (
                       to_tsvector('english', coalesce(summary, '') || ' ' || path)
                     ) STORED,
    metadata         JSONB        NOT NULL DEFAULT '{}',
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (vault, path)
  )`,
  `CREATE INDEX IF NOT EXISTS notes_embed_hnsw ON notes USING hnsw (embed vector_cosine_ops)`,
  `CREATE INDEX IF NOT EXISTS notes_fts_gin ON notes USING gin (fts)`,
  `CREATE INDEX IF NOT EXISTS notes_projects_gin ON notes USING gin (projects)`,
  `CREATE TABLE IF NOT EXISTS links (
    source_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    target_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    type      TEXT NOT NULL DEFAULT 'wikilink',
    PRIMARY KEY (source_id, target_id, type)
  )`,
]

export class PgStore implements Store {
  private pool: Pool

  constructor() {
    this.pool = new Pool(
      {
        hostname: config.db.hostname,
        port: config.db.port,
        database: config.db.database,
        user: config.db.user,
        password: config.db.password,
      },
      5,
      true,
    )
  }

  async init(): Promise<void> {
    log.info('db', `running ${DDL.length} DDL statements (postgres)`)
    const client = await this.pool.connect()
    try {
      for (const stmt of DDL) await client.queryArray(stmt)
    } finally {
      client.release()
    }
    log.info('db', 'postgres ready')
  }

  async close(): Promise<void> {
    await this.pool.end()
  }

  async upsertNote(p: NoteParams): Promise<void> {
    const vec = p.embed ? `[${p.embed.join(',')}]` : null
    const client = await this.pool.connect()
    try {
      await client.queryArray(`DELETE FROM notes WHERE vault = $1 AND path = $2 AND id != $3`, [p.vault, p.path, p.id])
      await client.queryArray(
        `INSERT INTO notes (id, vault, path, summary, projects, embed, embed_model, content_hash)
         VALUES ($1, $2, $3, $4, $5, $6::vector, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           vault           = EXCLUDED.vault,
           path            = EXCLUDED.path,
           summary         = EXCLUDED.summary,
           projects        = EXCLUDED.projects,
           embed       = EXCLUDED.embed,
           embed_model = EXCLUDED.embed_model,
           content_hash    = EXCLUDED.content_hash,
           updated_at      = NOW()`,
        [p.id, p.vault, p.path, p.summary, p.projects, vec, p.embedModel, p.contentHash],
      )
    } finally {
      client.release()
    }
  }

  async deleteNote(vault: string, path: string): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.queryArray(`DELETE FROM notes WHERE vault = $1 AND path = $2`, [vault, path])
    } finally {
      client.release()
    }
  }

  async getNoteByPath(vault: string, path: string): Promise<NoteRecord | null> {
    const client = await this.pool.connect()
    try {
      const res = await client.queryObject<{
        id: string
        content_hash: string | null
        embed_model: string | null
        projects: string[]
      }>(
        `SELECT id, content_hash, embed_model, projects FROM notes WHERE vault = $1 AND path = $2`,
        [vault, path],
      )
      const r = res.rows[0]
      if (!r) return null
      return {
        id: r.id,
        contentHash: r.content_hash,
        embedModel: r.embed_model,
        projects: r.projects,
      }
    } finally {
      client.release()
    }
  }

  async getNoteById(id: string): Promise<{ vault: string; path: string } | null> {
    const client = await this.pool.connect()
    try {
      const res = await client.queryObject<{ vault: string; path: string }>(
        `SELECT vault, path FROM notes WHERE id = $1`,
        [id],
      )
      return res.rows[0] ?? null
    } finally {
      client.release()
    }
  }

  async searchNotes(p: SearchParams): Promise<SearchResult[]> {
    const vec = `[${p.queryEmbedding.join(',')}]`
    const client = await this.pool.connect()
    try {
      const res = await client.queryObject<{
        id: string
        path: string
        summary: string | null
        projects: string[]
        score: string
      }>(
        `SELECT id, path, summary, projects,
           (embed <=> $1::vector) * $5::float8 +
           (1.0 - ts_rank(fts, plainto_tsquery('english', $2))) * $6::float8 AS score
         FROM notes
         WHERE vault = $3
           AND embed IS NOT NULL
           AND (embed <=> $1::vector) < $7::float8
         ORDER BY score ASC
         LIMIT $4`,
        [vec, p.query, p.vault, p.limit, p.vectorWeight, p.ftsWeight, p.vectorGate],
      )
      return res.rows.map((r) => ({
        id: r.id,
        path: r.path,
        summary: r.summary ?? '',
        projects: r.projects,
        score: Number(r.score),
      }))
    } finally {
      client.release()
    }
  }

  async searchNotesFts(vault: string, query: string, limit: number): Promise<SearchResult[]> {
    const client = await this.pool.connect()
    try {
      const res = await client.queryObject<{
        id: string
        path: string
        summary: string | null
        projects: string[]
        score: string
      }>(
        `SELECT id, path, summary, projects,
           1.0 - ts_rank(fts, plainto_tsquery('english', $1)) AS score
         FROM notes
         WHERE vault = $2
           AND fts @@ plainto_tsquery('english', $1)
         ORDER BY score ASC
         LIMIT $3`,
        [query, vault, limit],
      )
      return res.rows.map((r) => ({
        id: r.id,
        path: r.path,
        summary: r.summary ?? '',
        projects: r.projects,
        score: Number(r.score),
      }))
    } finally {
      client.release()
    }
  }

  async getNotesNeedingReindex(currentModel: string): Promise<Array<{ vault: string; path: string }>> {
    const client = await this.pool.connect()
    try {
      const res = await client.queryObject<{ vault: string; path: string }>(
        `SELECT vault, path FROM notes WHERE embed IS NULL OR embed_model IS DISTINCT FROM $1`,
        [currentModel],
      )
      return res.rows
    } finally {
      client.release()
    }
  }

  async checkDuplicate(vault: string, embed: number[], threshold: number): Promise<boolean> {
    const vec = `[${embed.join(',')}]`
    const client = await this.pool.connect()
    try {
      const res = await client.queryArray(
        `SELECT 1 FROM notes WHERE vault = $1 AND embed IS NOT NULL AND (embed <=> $2::vector) < $3 LIMIT 1`,
        [vault, vec, 1 - threshold],
      )
      return res.rows.length > 0
    } finally {
      client.release()
    }
  }

  async resolveNoteTarget(vault: string, target: string): Promise<string | null> {
    const client = await this.pool.connect()
    try {
      const res = await client.queryObject<{ id: string }>(
        `SELECT id FROM notes WHERE vault = $1 AND (
           path = $2 OR path = $2 || '.md' OR path LIKE '%/' || $2 || '.md' OR path LIKE '%/' || $2
         ) LIMIT 1`,
        [vault, target],
      )
      return res.rows[0]?.id ?? null
    } finally {
      client.release()
    }
  }

  async getNoteEmbed(vault: string, path: string): Promise<number[] | null> {
    const client = await this.pool.connect()
    try {
      const res = await client.queryObject<{ embed: string | null }>(
        `SELECT embed::text FROM notes WHERE vault = $1 AND path = $2`,
        [vault, path],
      )
      const embed = res.rows[0]?.embed
      if (!embed) return null
      return embed.slice(1, -1).split(',').map(Number)
    } finally {
      client.release()
    }
  }

  async getSourcesLinkingTo(targetId: string): Promise<Array<{ id: string; vault: string; path: string }>> {
    const client = await this.pool.connect()
    try {
      const res = await client.queryObject<{ id: string; vault: string; path: string }>(
        `SELECT n.id, n.vault, n.path FROM links l JOIN notes n ON l.source_id = n.id WHERE l.target_id = $1`,
        [targetId],
      )
      return res.rows
    } finally {
      client.release()
    }
  }

  async upsertLinks(sourceId: string, targets: Array<{ targetId: string; type: string }>): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.queryArray(`DELETE FROM links WHERE source_id = $1`, [sourceId])
      for (const { targetId, type } of targets) {
        await client.queryArray(
          `INSERT INTO links (source_id, target_id, type) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [sourceId, targetId, type],
        )
      }
    } finally {
      client.release()
    }
  }
}
