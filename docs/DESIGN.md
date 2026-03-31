# Prunus — Design

A centralized, network-accessible knowledge store for LLM coding tools. Clients connect via MCP over HTTP. Insights are
stored as Markdown files indexed in PostgreSQL + pgvector for hybrid search. Multiple named vaults live on one server —
each is an independent Obsidian-compatible Markdown directory.

---

## Goals

- Capture generalizable insights (architecture decisions, dependency patterns, language idioms, integration lessons)
  across multiple machines and projects
- Support multiple named vaults on a single server — each an independent knowledge domain (e.g. `code`, `recipe`) with
  its own Obsidian-compatible Markdown directory
- Expose a single MCP endpoint any Claude Code instance can read from and write to, with tools scoped to a named vault
- Be automatic enough that insights are captured without friction, but curated enough that only signal (not noise) is
  stored
- Vault files are the source of truth — the Postgres DB is a derived search index, fully rebuildable by re-scanning the
  vault directory
- Remain fully self-hosted and free to run

---

## Runtime and Toolchain

**Deno** — not Bun. Rationale:

- Same toolchain as wut/shire (JSR imports, `deno fmt`, `deno lint`, `deno check`, `deno task`)
- Native permission model (`--allow-net`, `--allow-read`, `--allow-env`) — meaningful for a network-exposed server
- No `node_modules` — cleaner repo
- `jsr:@db/postgres` covers Postgres natively; `deno task dev --watch` covers hot reload

Formatting rules match wut: no semicolons, single quotes, trailing commas only on multiline, always-braced `if` bodies.
Import sorting: std → external → local.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│  prunus server (Deno)                                        │
│                                                              │
│  Deno.serve() → auth → POST /mcp → MCP dispatcher           │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────────┐  │
│  │  db/     │  │  embed/  │  │  vaults/                 │  │
│  │ Postgres │  │  embed   │  │  code/   ← Obsidian-compat│  │
│  │ pgvector │  │  service │  │  recipe/ ← Obsidian-compat│  │
│  └──────────┘  └──────────┘  └──────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
         ↑  POST /mcp (StreamableHTTP, bearer token)
         │
┌────────────────────┐     ┌────────────────────┐
│  machine A         │     │  machine B         │
│  Claude Code       │     │  Claude Code       │
│  + prunus hooks    │     │  + prunus hooks    │
│  + .mcp.json       │     │  + .mcp.json       │
└────────────────────┘     └────────────────────┘
```

**Write path:**

1. `SessionEnd` hook fires on each client machine
2. Hook script calls Anthropic API with the session transcript, asking Claude to identify generalizable insights and
   call `log_insight` for each
3. `log_insight(vault, filename, content, summary, tags)` MCP call arrives at server → writes Markdown file with full
   frontmatter → immediately reindexes (embed + upsert PG)
4. Vault watcher catches any external edits (Obsidian, manual) asynchronously

**Read path:**

1. Claude calls `search_skills(vault, query)` → server embeds query + runs hybrid FTS+vector search scoped to that vault
   → returns `{id, path, summary, score}[]`
2. Claude calls `read_skill(vault, id)` for specific notes → returns full Markdown content
3. `UserPromptSubmit` hook on session start pushes the top-N most relevant summaries into Claude's context automatically
   (passive injection, no tool call needed)

---

## Component Boundaries

Each component below has a defined interface. They can be implemented independently in parallel.

### 1. `src/config.ts`

Reads and validates environment variables. Exported as a single `config` object. All other modules import from here — no
direct `Deno.env` calls elsewhere.

```
PRUNUS_HOSTNAME         bind address (default: 0.0.0.0)
PRUNUS_PORT             bind port (default: 9100)
PRUNUS_AUTH_TOKEN       bearer token for MCP endpoint auth

POSTGRES_HOSTNAME
POSTGRES_PORT
POSTGRES_DB
POSTGRES_USER
POSTGRES_PASSWORD

OPENAI_HOSTNAME         OpenAI-compat embed host
OPENAI_PORT             OpenAI-compat embed port
OPENAI_EMBED_MODEL      embedding model name (e.g. nomic-embed-text)
OPENAI_EMBED_DIMENSION  vector dimension (default: 1536; nomic-embed-text uses 768)
                        CHANGING THIS REQUIRES A FULL DB REBUILD (drop + remigrate)

PRUNUS_VAULT_PATH       absolute path to vaults root directory
                        each subdirectory is a named vault (e.g. vaults/code/, vaults/recipe/)

PRUNUS_SEARCH_VECTOR_WEIGHT  hybrid search vector weight (default: 0.6)
PRUNUS_SEARCH_FTS_WEIGHT     hybrid search FTS weight (default: 0.4)
PRUNUS_SEARCH_VECTOR_GATE    max cosine distance to include in results (default: 0.8)
PRUNUS_DEDUP_THRESHOLD       cosine similarity above which a recap candidate is considered
                             already known and filtered (default: 0.85)
PRUNUS_SESSION_TTL_DAYS      client session directories older than this are pruned (default: 30)
```

**Interface exported:** `config` (typed record, throws on missing required vars)

---

### 2. `src/log.ts`

Structured logger. Methods: `log.info`, `log.warn`, `log.error`, `log.debug`. Each line is
`[ISO timestamp] LEVEL component message {json}`. No external deps.

**Interface exported:** `log` object

---

### 3. `src/db/`

PostgreSQL client and all query logic. Uses `jsr:@db/postgres`. No raw SQL outside this directory — all callers use
typed functions.

**Files:**

`client.ts` — creates and exports the `sql` pool from `config.db`.

`schema.ts` — exports `SCHEMA: string[]`, the ordered DDL statements:

- `CREATE EXTENSION IF NOT EXISTS vector`
- `notes` table: `id UUID`, `vault TEXT`, `path TEXT`, UNIQUE constraint on `(vault, path)`, `summary TEXT`,
  `origin_project TEXT`, `projects TEXT[]`, `embedding VECTOR(n)` (n = `OPENAI_EMBED_DIMENSION`),
  `embedding_model TEXT`, `content_hash TEXT`, `fts TSVECTOR` (generated from summary + path), `metadata JSONB`,
  `created_at`, `updated_at`
- GIN index on `projects` for fast `projects @> ARRAY['my-project']` filtering
- HNSW index on `embedding`
- GIN index on `fts`
- `links` table: `source_id UUID`, `target_id UUID`, `type` ('wikilink' | 'depends_on') (links are always within a vault
  — source and target share the same vault)

`migrate.ts` — runs schema statements idempotently on startup. Exports `migrate(): Promise<void>`.

`queries/notes.ts` — exports:

- `upsertNote(note: NoteRow): Promise<void>` — insert or update by (vault, path)
- `deleteNote(vault: string, path: string): Promise<void>`
- `getNoteById(id: string): Promise<NoteRow | null>`
- `getNoteByPath(vault: string, path: string): Promise<NoteRow | null>`
- `searchHybrid(vault: string, embedding: number[], ftsQuery: string, limit: number): Promise<NoteResult[]>` Returns
  `{id, path, summary, score}[]` scoped to vault, ranked by combined vector cosine + ts_rank.

`queries/links.ts` — exports:

- `upsertLink(sourceId: string, targetId: string, type: string): Promise<void>`
- `getLinksForNote(id: string): Promise<LinkResult[]>`

`queries/vaults.ts` — exports:

- `listVaults(): Promise<string[]>` — distinct vault names from notes table

**Types exported:** `NoteRow`, `NoteResult`, `LinkResult`

---

### 4. `src/embed/`

OpenAI-compatible embedding client. Single responsibility: text → float[].

`client.ts` — exports `embed(text: string): Promise<number[]>`. POSTs to `config.embed.baseUrl/v1/embeddings` with model
from config. Throws on non-2xx or missing embedding in response.

---

### 5. `src/index-queue.ts`

Single in-memory async pipeline for all vault indexing operations. Every path that modifies vault content —
`log_insight`, `update_insight`, and the watcher — enqueues jobs here. Nothing embeds or writes to the DB directly.

**Why a queue:**

- Serializes embed calls to the same `(vault, path)` — no duplicate embed from watcher picking up a file that
  `log_insight` just wrote
- Bounded concurrency for embed service calls (configurable, default 2)
- Automatic retry on embed failure before marking the note as `embedding: null`
- Decouples MCP tool response time from embed latency — tools return after the file write; the DB update happens in the
  background

**Jobs:**

- `{ type: 'reindex', vault, path }` — read file, check content_hash, if changed: embed summary, upsert DB row, update
  links table
- `{ type: 'delete', vault, path }` — delete note and its links from DB

**Deduplication:** if a `reindex` job for `(vault, path)` is already pending in the queue, the newer job replaces it.
Rapid saves (e.g. Obsidian autosave) collapse to one embed call.

**Exports:**

- `enqueue(job: IndexJob): void` — add job to queue (fire-and-forget)
- `drain(): Promise<void>` — wait for all pending jobs to finish (used in tests)

---

### 6. `src/vault/`

Markdown file I/O. Each named vault is a subdirectory under `config.vaultsBase`. Each vault directory is independently
Obsidian-compatible: wikilinks, YAML frontmatter, arbitrary folder structure. The DB is a derived search index — fully
rebuildable from the vault files alone.

**Frontmatter spec** — every note written by prunus must include:

```yaml
---
id: <uuid v4>                    # stable identifier; written once, never changed
summary: <text>                  # 2-3 line summary; used for embeddings + search results
created: <ISO 8601>              # written once on first log_insight call
updated: <ISO 8601>              # updated on every rewrite
origin_project: <name>           # project that first created this note; written once
projects: [project-a, project-b] # all projects that have applied this pattern (grows over time)
tags: [tag1, tag2]               # optional topic tags
---
```

The DB stores nothing that cannot be reconstructed from these fields plus the file content. Embeddings are regenerated
from `summary` on rebuild (no data loss). Links are rebuilt by re-parsing wikilinks from note bodies.

**Project association** — `origin_project` is written once at creation and never changed. `projects` is a growing list —
the first time an insight is logged the origin project is added, and each time an existing note is updated from a
different project that project is merged in. A note with many projects is broadly applicable knowledge. The hook derives
the project name from `cwd` basename (or a configured override).

**Embedding model lifecycle** — `embedding_model` is stored per note in the DB alongside the vector. On startup, the
server checks whether the configured `OPENAI_EMBED_MODEL` matches what is stored in the DB. If they differ, all notes
are queued for re-embedding. Changing `OPENAI_EMBED_DIMENSION` requires a full schema rebuild (drop + remigrate) since
the vector column type cannot be altered in place.

**Queue persistence** — the index queue is in-memory. If the server crashes with pending jobs, those jobs are lost. The
startup scan recovers by re-queuing all notes with `embedding: null` or `embedding_model` mismatch. File writes are
always persisted to disk before the job is enqueued, so no content is ever lost.

**Write lock growth** — the per-`(vault, path)` mutex map in `writer.ts` grows with each distinct path written. For a
personal knowledge store this is bounded and negligible. Map entries are never explicitly removed; this is acceptable
because the number of distinct note paths is small relative to available memory.

**PG role** — derived read index only. PG holds embeddings, FTS vectors, link graph, and content hashes — all computable
from the Markdown files. Nothing is authoritative in PG that isn't already in the vault. On startup the watcher scans
all files and uses `content_hash` to skip unchanged ones, catching any drift from edits made while the server was
offline. Vault backup strategy is out of scope for prunus.

**Double-index prevention** — `log_insight` writes the file then enqueues a reindex job. The watcher fires for that same
write and enqueues another reindex job. The queue worker always checks `content_hash` first; the second job finds the
hash already matches and exits early. No duplicate embed call.

**Wikilink resolution** — only basic `[[path]]` syntax is supported. Path is resolved relative to the vault root (not
the containing file's directory). Variants like `[[file#section]]` and `[[file|display text]]` are parsed by stripping
the `#...` and `|...` suffixes to extract the base path. Dangling links (target file does not exist) are stored in the
`links` table without a `target_id` until the target is created.

**Embedding service downtime** — the file write completes regardless of embed service availability. If the embed call
fails, the queue retries up to 3 times with backoff, then stores the note with `embedding: null`. The startup scan
re-queues all notes with null embeddings so they are indexed once the service comes back.

`reader.ts` — exports:

- `readNote(vault: string, relativePath: string): Promise<string>`
- `noteExists(vault: string, relativePath: string): Promise<boolean>`
- `listNotes(vault: string): AsyncIterable<string>` — yields relative paths of all `*.md` files
- `listVaultNames(): Promise<string[]>` — lists subdirectory names under `config.vaultsBase`

`writer.ts` — exports:

- `writeNote(vault: string, relativePath: string, content: string): Promise<void>` Creates parent directories as needed.
  Uses a per-`(vault, path)` async mutex so concurrent writes to the same file are serialized (last writer wins, no torn
  files). The mutex is a chained Promise stored in a module-level `Map<string, Promise<void>>`; no external lock library
  needed.

`parser.ts` — exports:

- `parseNote(content: string): ParsedNote` Extracts YAML frontmatter and body. Extracts `[[wikilink]]` targets from
  body. `ParsedNote: { frontmatter: Record<string, unknown>, body: string, wikilinks: string[] }`

`watcher.ts` — exports:

- `startVaultWatcher(): Promise<void>` For each vault: initial scan of all `.md` files → enqueues `reindex` jobs. Then
  `Deno.watchFs(vaultsBase)` loop for all vaults simultaneously. On create/modify:
  `enqueue({ type: 'reindex', vault, path })`. On delete: `enqueue({ type: 'delete', vault, path })`. Does not embed or
  touch the DB directly — all indexing goes through the queue.

---

### 6. `src/auth.ts`

Bearer token middleware. Reads `Authorization: Bearer <token>` header. Compares to `config.prunus.authToken` using
constant-time comparison. Returns `401` with plain text body if missing or wrong. Exports
`checkAuth(req: Request): Response | null` — null means allowed.

If `config.prunus.authToken` is empty, auth is disabled (useful for local dev).

---

### 7. `src/mcp/`

MCP server wired to the Deno HTTP server via the existing `RequestTransport` pattern. One `McpServer` instance per
request (stateless).

`server.ts` — exports `createMcpServer(): McpServer`. Creates server, calls `registerTools(server)`, returns it.

`transport.ts` — keep the existing `RequestTransport` implementation as-is. It correctly handles the stateless
request/response dispatch pattern.

`tools/index.ts` — calls `register()` for each tool file.

**Tools (one file each):**

`tools/search_skills.ts`

- Input: `{ vault: string, query: string, limit?: number (default 5), project?: string }`
- Embeds `query` via `embed()`, runs `searchHybrid(vault, ...)` scoped to that vault
- Optional `project` filter: restricts results to notes that include that project
- Returns compact `{id, path, summary, projects, score}[]` — never full content
- `projects` list in results lets Claude judge how broadly applicable a note is
- Purpose: Step 1 of 2-layer retrieval. Cheap. Returns IDs for follow-up.

`tools/read_skill.ts`

- Input: `{ vault: string, id: string }`
- Looks up note by id in db to get path, reads full Markdown from vault
- Returns full file content
- Purpose: Step 2 of 2-layer retrieval. Only called for notes search identified as relevant.

`tools/log_insight.ts`

- Input: `{ vault: string, filename: string, content: string, summary: string, project: string, tags?: string[] }`
- Validates `filename` is a relative path ending in `.md`, no `..` traversal
- If file already exists: reads current frontmatter, merges `project` into existing `projects` list (deduped), preserves
  original `id` and `created`
- If new: generates fresh `id`, sets `created`, initializes `projects: [project]`
- Calls `vault.writeNote()` (serialized by write lock), then `enqueue({ type: 'reindex', ... })`
- Returns `{ id, path }` immediately after file write — embed + DB update happen async via queue
- Purpose: Primary write path. Called by Claude during or after session.

`tools/get_relevant_links.ts`

- Input: `{ vault: string, id: string }`
- Queries `links` table for note, joins with notes to return `{id, path, summary}[]`
- Purpose: Graph traversal — find related notes by wikilink relationships.

`tools/list_profiles.ts`

- Input: `{ vault: string }`
- Reads all files from `profiles/` in the named vault, parses frontmatter for name + description
- Returns `{name, description}[]`
- Purpose: Mid-session profile discovery or reconfigure prompt.

`tools/update_insight.ts`

- Input: `{ vault: string, id: string, content: string, summary: string }`
- Reads existing note by id to get path, preserves `id`/`created`/`projects` from frontmatter
- Calls `vault.writeNote()` with updated content + bumped `updated`, then enqueues reindex
- Returns `{ id, path }` after file write; embed + DB update async via queue
- Purpose: Correct or refine an existing note without changing its identity or project history.

`tools/list_vaults.ts`

- Input: none
- Returns `string[]` of vault names (subdirectory names under `config.vaultsBase`)
- Purpose: Let Claude discover which vaults are available before calling other tools.

---

### 8. `src/srv.ts`

Main entry point. Wires everything together.

- Calls `migrate()` on startup (non-fatal on failure, logs warning)
- Calls `seedProfiles()` on startup — writes starter profile files to vault if `profiles/` directory is empty (first run
  only)
- Calls `startVaultWatcher()` on startup
- `Deno.serve()` with routes:
  - `POST /mcp` — MCP dispatcher (auth required)
  - `GET /vaults` — returns `string[]` of vault names (auth required)
  - `GET /vaults/{vault}/profiles` — returns `[{name, description}]` JSON (auth required)
  - `GET /vaults/{vault}/profiles/{name}` — returns profile Markdown content (auth required)
  - `GET /health` — returns JSON `{status, postgres, embed_service, vaults_writable, queue_depth, null_embeddings}` (no
    auth)
  - `GET /` — minimal liveness check, returns `200 prunus` (no auth)
- Auth applied to all routes except `GET /` and `GET /health`

---

## Profiles

Profiles are server-side templates that define what a client should capture and store. They live in `profiles/` inside
each vault directory, and are fetched by the install script. Multiple machines can select the same profiles for
consistent behavior. A machine can select multiple profiles — their guidance is combined.

Profiles are per-vault. The install script first asks which vault to configure for, then lists that vault's profiles for
selection. A client config can reference profiles from multiple vaults if needed.

### Profile format

```markdown
---
name: deno-typescript
description: Deno/TypeScript tooling, runtime patterns, JSR ecosystem
---

## Capture

- Runtime and language patterns (Deno APIs, TypeScript idioms, JSR package decisions)
- Dependency choices and the reasoning behind them
- Cross-tool integration patterns (MCP, HTTP APIs, shell interop)
- Architecture tradeoffs discovered during implementation
- Non-obvious gotchas and their fixes

## Skip

- Project-specific business logic
- One-off bug fixes with no generalizable lesson
- Anything already well-documented in official docs
```

Profiles are excluded from `search_skills` results (path prefix `profiles/` is filtered). Served via
`GET /vaults/{vault}/profiles` (list) and `GET /vaults/{vault}/profiles/{name}` (content) — plain HTTP, no MCP needed,
so the install script can fetch them before MCP is configured. Also accessible mid-session via the `list_profiles` MCP
tool.

### Starter profiles (seeded into each vault on first run)

- `profiles/deno-typescript.md` — Deno, TypeScript, JSR, MCP tooling
- `profiles/infrastructure.md` — containers, systemd, networking, self-hosted services
- `profiles/python-data.md` — Python, data pipelines, ML infrastructure
- `profiles/general.md` — language-agnostic: architecture patterns, API design, tooling

Users add their own by creating files in `profiles/` — they are just vault notes.

---

## Client-Side (`client/`)

Installed on each machine that uses prunus. No local daemon. No local database. Config files, hook scripts, and a slash
command.

### Session data layout

```
~/.config/prunus/sessions/
  {session_id}/
    transcript.jsonl     # one JSON object per line: {role, content, ts}
    compact-pending      # marker file: present if PreCompact fired without a recap
    recapped             # marker file: present after /prunus ran successfully
```

`transcript.jsonl` line schema:

```json
{"role": "user", "content": "...", "ts": "2026-03-23T10:00:00Z"}
{"role": "assistant", "content": "...", "ts": "2026-03-23T10:00:05Z"}
```

**Session cleanup** — `UserPromptSubmit` (first turn) prunes session directories in the background (no stdout impact):

- Directories with a `recapped` marker: delete `transcript.jsonl` immediately (marker kept for audit)
- Directories older than `PRUNUS_SESSION_TTL_DAYS` (default 30): delete entire directory This keeps the sessions
  directory bounded without any manual maintenance.

### Client config: `~/.config/prunus/config.json`

Written by the install script. Read by all hook scripts.

```json
{
  "serverUrl": "https://my-prunus:9100",
  "authToken": "...",
  "defaultVault": "code",
  "profileIds": ["deno-typescript", "infrastructure"],
  "sessionDir": "~/.config/prunus/sessions"
}
```

### Install script: `client/install.ts`

```
deno run --allow-all client/install.ts --server https://my-prunus:9100 --token <token>
```

Steps:

1. Fetches `GET /vaults` → user selects default vault (e.g. `code`)
2. Fetches `GET /vaults/{vault}/profiles` → displays numbered list (name + description)
3. User selects one or more profiles by number
4. Writes `~/.config/prunus/config.json` (with `defaultVault`)
5. Writes hook scripts to `~/.config/prunus/hooks/`
6. Appends hook entries to `~/.claude/settings.json` (user-level — global install)
7. Writes prunus MCP server entry to `~/.claude/mcp.json` (user-level)

A `--reconfigure` flag re-runs only the profile selection step (steps 1-3).

### Hook: `client/hooks/prompt-submit.ts`

Triggered by `UserPromptSubmit`. Runs at the start of every prompt turn.

Always: appends user prompt to `~/.config/prunus/sessions/{session_id}/transcript.jsonl`.

First turn only (detected by absence of session marker file):

1. Fetches selected profile content from `GET /vaults/{vault}/profiles/{name}` for each configured profile
2. Calls `search_skills(defaultVault, ...)` with the user's first prompt to find relevant vault notes
3. Writes combined context block to stdout (injected into Claude's context):

```
[prunus: capture profile]
Deno/TypeScript: capture runtime patterns, dependency decisions, cross-tool integration.
Infrastructure: capture container design, service architecture, networking patterns.
Skip: project-specific logic, one-off fixes, well-documented stdlib behavior.
[end prunus capture profile]

[prunus: relevant knowledge]
- deno/import-maps.md: Import maps in Deno 2 replace importMap; use deno.json imports key ...
- deno/permissions.md: Prefer --allow-read=specific/path over --allow-read ...
[end prunus relevant knowledge]
```

4. Scans all session directories for `compact-pending` markers without a `recapped` marker (prior sessions with
   unreviewed insights). If any found, appends to the injected context:

```
[prunus: pending recap]
1 prior session has unreviewed insight candidates. Run /prunus to review.
[end]
```

5. Writes session marker file to suppress injection on subsequent turns.

### Hook: `client/hooks/stop.ts`

Triggered by `Stop` (fires after each Claude response).

Appends Claude's response text to `~/.config/prunus/sessions/{session_id}/transcript.jsonl`. No stdout — purely
collection.

### Hook: `client/hooks/pre-compact.ts`

Triggered by `PreCompact`.

Writes `~/.config/prunus/sessions/{session_id}/compact-pending` marker. The `/prunus` slash command checks this and
prioritizes recap before context is compressed. No stdout — the user decides when to run the recap.

### Slash command: `client/commands/prunus.md`

Installed to `~/.claude/commands/prunus.md`. Invoked with `/prunus` at any point.

Instructs Claude to:

1. Read `~/.config/prunus/sessions/{session_id}/transcript.jsonl`
2. Extract candidate insights matching the active capture profile guidance
3. For each candidate, call `search_skills` to check similarity against existing vault notes
4. Filter out candidates with cosine similarity > `PRUNUS_DEDUP_THRESHOLD` (default 0.85) to any existing vault note
5. Present novel candidates to the user as a numbered list with brief descriptions
6. User confirms which to keep (by number, "all", or "none")
7. Call `log_insight` for each confirmed candidate, passing `project` from session `cwd`
8. Write `recapped` marker to session directory

The dedup step keeps the list short: frequently rediscovered patterns (standard library behavior, common idioms) are
filtered before the user sees them.

### MCP config entry (written by install script)

```json
{
  "prunus": {
    "type": "http",
    "url": "${PRUNUS_SERVER_URL}/mcp",
    "headers": {
      "Authorization": "Bearer ${PRUNUS_AUTH_TOKEN}"
    }
  }
}
```

---

## Data Model

### `notes` table

| column            | type                 | notes                                                                       |
| ----------------- | -------------------- | --------------------------------------------------------------------------- |
| `id`              | UUID PK              | from frontmatter `id` field; stable across DB rebuilds                      |
| `vault`           | TEXT NOT NULL        | vault name, e.g. `code`                                                     |
| `path`            | TEXT NOT NULL        | relative path within vault, e.g. `typescript/decorators.md`                 |
|                   | UNIQUE (vault, path) |                                                                             |
| `summary`         | TEXT                 | from frontmatter `summary`; used for embeddings + search results            |
| `origin_project`  | TEXT                 | from frontmatter `origin_project`; the project that first created this note |
| `projects`        | TEXT[]               | from frontmatter `projects`; grows as more projects apply this pattern      |
| `embedding`       | VECTOR(n)            | of `summary` text; n = `OPENAI_EMBED_DIMENSION`; regenerated on rebuild     |
| `embedding_model` | TEXT                 | model name used to generate the embedding; used to detect drift on startup  |
| `content_hash`    | TEXT                 | SHA-256 of file content; used to skip re-embedding unchanged files          |
| `fts`             | TSVECTOR GENERATED   | `to_tsvector('english', coalesce(summary,'') \|\| ' ' \|\| path)`           |
| `metadata`        | JSONB                | remaining frontmatter fields (tags, arbitrary keys)                         |
| `created_at`      | TIMESTAMPTZ          | from frontmatter `created`                                                  |
| `updated_at`      | TIMESTAMPTZ          | from frontmatter `updated`; updated on each reindex                         |

### `links` table

Populated by `parser.ts` extracting `[[wikilink]]` patterns from note content, and by the `depends_on` relationship type
that `log_insight` can set explicitly.

---

## Hybrid Search

```sql
SELECT id, path, summary, projects,
  (embedding <=> $2::vector) * $5          -- PRUNUS_SEARCH_VECTOR_WEIGHT
    + (1.0 - ts_rank(fts, websearch_to_tsquery('english', $3))) * $6  -- PRUNUS_SEARCH_FTS_WEIGHT
  AS score
FROM notes
WHERE vault = $1
  AND (
    embedding <=> $2::vector < $7          -- PRUNUS_SEARCH_VECTOR_GATE
    OR fts @@ websearch_to_tsquery('english', $3)
  )
ORDER BY score ASC
LIMIT $4
```

`websearch_to_tsquery` accepts natural language (spaces, quotes, minus) without operator syntax. Weights and gate are
configurable via env vars (see config). Defaults: vector 0.6, FTS 0.4, gate 0.8. Increase vector weight for semantic
queries; increase FTS weight for exact-term queries. Embedding is of the `summary` field only — keeps vectors focused
and cheap to regenerate.

---

## Parallels with claude-mem

| concern           | claude-mem approach                | prunus approach                                         |
| ----------------- | ---------------------------------- | ------------------------------------------------------- |
| Write trigger     | automatic (every PostToolUse)      | automatic (SessionEnd agent) + explicit (`log_insight`) |
| Write target      | local SQLite rows                  | Markdown files in named vault directory                 |
| Source of truth   | SQLite                             | Markdown files (DB is derived, fully rebuildable)       |
| Vector store      | Chroma (separate Python process)   | pgvector (same Postgres instance)                       |
| Relational store  | SQLite                             | Postgres                                                |
| Embedding         | Claude API                         | OpenAI-compat (local or remote)                         |
| MCP transport     | stdio (local process)              | StreamableHTTP (network, multi-client)                  |
| Context injection | SessionStart hook pushes summaries | UserPromptSubmit hook pushes summaries                  |
| Search pattern    | 3-layer: search → timeline → get   | 2-layer: search_skills → read_skill                     |
| Session curation  | SDK agent → SQLite summaries       | SDK agent → log_insight → vault                         |
| Auth              | none (local only)                  | bearer token                                            |
| Multi-machine     | not supported                      | first-class                                             |

---

## Implementation Order and Parallel Tracks

The components are independent enough that tracks A, B, C can proceed in parallel. Track D (integration) depends on all
three completing.

### Track A — Server foundation

1. `src/config.ts` — env parsing; `PRUNUS_VAULT_PATH`
2. `src/log.ts` — structured logger
3. `src/auth.ts` — bearer token check
4. `src/srv.ts` — `Deno.serve()` with `/mcp`, `GET /vaults`, `GET /vaults/{v}/profiles`, `GET /`
5. `src/mcp/transport.ts` — `RequestTransport` for StreamableHTTP using Deno APIs
6. `src/mcp/server.ts` — `createMcpServer()` stub (no tools yet)
7. `src/vault/seed.ts` — `seedProfiles(vault)`: writes starter profile files on first run
8. `deno.json` — tasks: `dev`, `fmt`, `lint`, `check`, `test`

### Track B — Database and embeddings

1. `src/embed/client.ts` — OpenAI-compat embed call
2. `src/db/client.ts` — Deno postgres pool from config
3. `src/db/schema.ts` — DDL with `vault` column, composite unique `(vault, path)`, pgvector + FTS
4. `src/db/migrate.ts` — idempotent migration runner
5. `src/db/queries/notes.ts` — upsert, delete, getById, getByPath, searchHybrid (all vault-scoped)
6. `src/db/queries/links.ts` — upsert, getForNote
7. `src/db/queries/vaults.ts` — listVaults

### Track C — Vault + queue

1. `src/index-queue.ts` — async queue: enqueue, drain, bounded embed concurrency, retry, dedup by (vault,path)
2. `src/vault/reader.ts` — readNote, noteExists, listNotes, listVaultNames
3. `src/vault/writer.ts` — writeNote with per-(vault,path) async mutex
4. `src/vault/parser.ts` — frontmatter + body extraction, wikilink extraction
5. `src/vault/watcher.ts` — Deno.watchFs on vaultsBase; enqueues jobs, no direct embed/DB

### Track D — MCP tools (requires A + B + C)

1. `src/mcp/tools/list_vaults.ts`
2. `src/mcp/tools/search_skills.ts`
3. `src/mcp/tools/read_skill.ts`
4. `src/mcp/tools/log_insight.ts`
5. `src/mcp/tools/update_insight.ts`
6. `src/mcp/tools/get_relevant_links.ts`
7. `src/mcp/tools/list_profiles.ts`
8. `src/mcp/tools/index.ts` — register all tools
9. Wire tools into `createMcpServer()`

### Track E — Client (independent of A-D, can run in parallel)

1. `client/hooks/prompt-submit.ts` — UserPromptSubmit: transcript append + first-turn injection + pending recap scan
2. `client/hooks/stop.ts` — Stop: transcript append
3. `client/hooks/pre-compact.ts` — PreCompact: write compact-pending marker
4. `client/commands/prunus.md` — /prunus slash command: recap, dedup, user selection, log_insight
5. `client/install.ts` — vault + profile selection, writes config + hooks + settings.json + mcp.json

### Final — Cleanup and integration review

- Ensure no `node_modules`, `package.json`, or `tsconfig.json` crept in
- Verify `deno.json` tasks: `dev`, `fmt`, `lint`, `check`, `test`
- End-to-end test: install client → start server → Claude session → verify insight in vault + db
- Review hybrid search quality on real queries
