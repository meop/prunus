# Prunus — Design

A centralized, network-accessible knowledge vault server for LLM coding tools. Clients connect via MCP over HTTP. Notes
are stored as Markdown files indexed in SQLite (default) or PostgreSQL + pgvector for hybrid search. Multiple named
vaults live on one server — each is an independent knowledge domain with its own Obsidian-compatible Markdown directory.

---

## Runtime and Toolchain

**Deno** — not Bun. Config is read from `settings.toml` (symlinked to `settings-dev.toml`; override with
`PRUNUS_ENV=test` to load `settings-test.toml`). No `node_modules`. All imports via JSR or `npm:` specifiers.

Development tasks:

```bash
deno task dev       # hot reload
deno task fmt       # apply formatting
deno task lint      # lint
deno task check     # type check
deno task test      # run tests
```

---

## Architecture

```
prunus server (Deno)
  Deno.serve() → routes:
    GET  /                          probe (no auth)
    GET  /health                    {status, db, embed_service, queue_depth} (no auth)
    GET  /cli/{path}                client install files (no auth)
    GET  /vault/{vault}/context     combined capture profile for first-turn injection (auth)
    POST /vault/{vault}/ingest      {project, transcript, since?} → 202 fire-and-forget (auth)
    POST /mcp                       MCP JSON-RPC (auth)

Clients → POST /vault/{vault}/ingest   (session transcripts, async)
        → POST /mcp                    (read/write tools)
        → GET  /vault/{vault}/context  (per-prompt relevant note summaries)
```

Client install (on each client machine):

```sh
deno run --allow-all http://prunus-host:9100/cli/install
```

---

## Source Layout

```
src/
  srv.ts              # Entry — Deno.serve(), all routes
  settings.ts         # TOML settings loader
  config.ts           # Typed config object
  health.ts           # GET /health handler
  log.ts              # Structured logger
  auth.ts             # Bearer token middleware
  queue.ts            # Async job pipeline — all writes flow through here

  db/
    store.ts          # Store interface (both backends implement this)
    pg.ts             # PostgreSQL + pgvector + HNSW + TSVECTOR
    sqlite.ts         # SQLite + sqlite-vec native extension (JS cosine fallback)
    index.ts          # createStore() factory — selects backend from db.type

  llm/
    chat.ts           # POST /v1/chat/completions (OpenAI-compat, tool_calls support)
    embed.ts          # POST /v1/embeddings (OpenAI-compat)
    agent.ts          # Agentic loop — chatWithTools, tool dispatch, loop until finish()

  ingest/
    index.ts          # Transcript → LLM extraction → prune jobs

  vault/
    parser.ts         # Frontmatter parse/serialize, wikilink extraction, content hash
    reader.ts         # readNote(vault, path) → ParsedNote
    writer.ts         # writeNote with per-(vault,path) async mutex
    watcher.ts        # Deno.watchFs → enqueue jobs
    profiles.ts       # Load and combine enabled profiles from {vault}/.profiles/ symlinks
    see-also.ts       # Manage ## See also sections

  mcp/
    server.ts
    transport.ts      # Stateless RequestTransport for Deno.serve
    tools/
      note/           # search_notes, read_note
      vault/          # list_vaults, create_vault, delete_vault
      profile/        # list_profiles, enable_profile, disable_profile

src/cli/              # Installed on each client machine; config in ~/.prunus/
  install.ts          # Unified installer
  prunus.md           # /prunus slash command source
  hooks/
    mod.ts            # Shared utilities (loadSettings, runIngest, sweepMarkers, …)
    claude-code/      # user-prompt-submit.ts, stop.ts, pre-compact.ts
    gemini-cli/       # before-agent.ts, session-end.ts, pre-compress.ts
    qwen-code/        # user-prompt-submit.ts, session-end.ts, pre-compact.ts
    opencode/
  plugins/
    opencode/
      prunus.ts       # TS plugin: ingest on session.idle; context inject at session.compacting
```

---

## Ingest Pipeline (Write Path)

1. Client POSTs session transcript to `POST /vault/{vault}/ingest`
2. Server responds `202` immediately — all processing is async background
3. One LLM call (`chat`) identifies knowledge chunks: `[{topic, excerpt}]` from the transcript
4. Each chunk becomes a `prune` job in the queue
5. **prune job** — agentic LLM loop with vault tools (`search_notes`, `read_note`, `write_note`, `delete_note`,
   `finish`): decides whether to update an existing note, create a new one, or delete outdated content
6. After every N prune completions (config: `vault.shape_interval`, default 20) a `shape` job fires
7. **shape job** — agentic LLM loop that reviews the whole vault: merges, deletes, and restructures notes

---

## Queue (`src/queue.ts`)

Job types: `reindex | delete | prune | shape`

| Job       | Description                                                        |
| --------- | ------------------------------------------------------------------ |
| `reindex` | Embed + upsert DB + resolve wikilinks. Pure mechanical, no LLM.    |
| `delete`  | Clean stale links in related notes, then remove from DB.           |
| `prune`   | LLM agent integrates one knowledge chunk into the vault.           |
| `shape`   | LLM agent reorganizes the entire vault (periodic, every N prunes). |

- Dedup by job key; concurrency = 2; retry up to 3× with backoff
- Prune count persisted to `stats.json` (in `db.sqlite.path` dir) for restart-safe shape triggering

---

## Read Path (MCP)

Fast two-layer retrieval:

1. Client calls `search_notes` — hybrid vector + FTS search → returns `{path, summary, score}[]`
2. Client calls `read_note` for full content of relevant notes

Context injection: the `UserPromptSubmit` hook calls `GET /vault/{vault}/context?query=<prompt>` on every prompt submit,
receiving relevant note summaries. These are injected into the prompt context, with a hint to call `read_note` if full
content is needed.

---

## MCP Tools

| Tool              | Description                                              |
| ----------------- | -------------------------------------------------------- |
| `search_notes`    | Hybrid vector + FTS search across all notes in the vault |
| `read_note`       | Read a note's full Markdown content                      |
| `list_vaults`     | List available vault names                               |
| `create_vault`    | Create a new named vault directory                       |
| `delete_vault`    | Delete a vault and all its contents                      |
| `list_profiles`   | List all profiles + which are enabled for a vault        |
| `enable_profile`  | Enable a profile for a vault (creates symlink)           |
| `disable_profile` | Disable a profile for a vault (removes symlink)          |
| `create_profile`  | Create a new profile definition                          |
| `update_profile`  | Update a profile definition                              |
| `delete_profile`  | Delete a profile definition                              |

---

## Configuration (`src/settings.ts` + `src/config.ts`)

Config is read from `settings.toml` (or `settings-{env}.toml` via `PRUNUS_ENV`):

```toml
[srv]
hostname = "0.0.0.0"
port = 9100

[srv.auth]
token = ""

[log]
level = "debug"   # debug | info | warn | error

[db]
type = "sqlite"   # sqlite | postgres

[db.sqlite]
path = "/path/to/db"

# [db.postgres]
# hostname = "..."  port = 5432  database = "prunus"  user = "..."  password = "..."

[llm]
hostname = "localhost"
port = 1234

[llm.chat]
model = "..."

[llm.embed]
model = "..."
dimension = 1024   # must match model; changing requires full DB rebuild

[vault]
path = "/path/to/vaults"
# configDir = "..."        # optional; defaults to sibling prunus-config/ dir
# shape_interval = 20      # prune jobs between shape runs

# [search]
# vector_weight = 0.6  fts_weight = 0.4  vector_gate = 0.8  dedup_threshold = 0.85
```

---

## Database Backends

Both backends implement the `Store` interface in `src/db/store.ts`. The active backend is selected at startup by
`db.type`.

**SQLite (default):** `jsr:@db/sqlite`, `sqlite-vec` native extension for vectors (auto-downloaded on first startup), JS
cosine similarity fallback.

**PostgreSQL:** `jsr:@db/postgres`, `pgvector`, HNSW index, generated `TSVECTOR`.

Source of truth is always the Markdown files. The DB is derived and fully rebuildable by rescanning the vault directory.

---

## Data Model

### `notes` table

| Column         | Type                 | Notes                                                                    |
| -------------- | -------------------- | ------------------------------------------------------------------------ |
| `id`           | UUID PK              | From frontmatter `id`; stable across DB rebuilds                         |
| `vault`        | TEXT NOT NULL        | Vault name, e.g. `code`                                                  |
| `path`         | TEXT NOT NULL        | Relative path within vault, e.g. `typescript/decorators.md`              |
|                | UNIQUE (vault, path) |                                                                          |
| `summary`      | TEXT                 | From frontmatter `summary`; used for embeddings and search results       |
| `projects`     | TEXT[]               | From frontmatter `projects[]`; grows as more projects reference the note |
| `embed`        | VECTOR(n)            | Of `summary` text; n = `llm.embed.dimension`                             |
| `embed_model`  | TEXT                 | Model name used to generate the embedding; drift detected on startup     |
| `content_hash` | TEXT                 | SHA-256 of file content; skip re-embedding unchanged files               |
| `fts`          | TSVECTOR             | Generated from summary + path                                            |
| `metadata`     | JSONB                | Remaining frontmatter fields (tags, arbitrary keys)                      |
| `created_at`   | TIMESTAMPTZ          | From frontmatter `created`                                               |
| `updated_at`   | TIMESTAMPTZ          | From frontmatter `updated`                                               |

### `links` table

| Column      | Type              |
| ----------- | ----------------- |
| `source_id` | UUID              |
| `target_id` | UUID              |
| `type`      | TEXT (`wikilink`) |

Populated by parsing `[[wikilink]]` patterns from note bodies. Links are always within a vault.

---

## Vault Files (`src/vault/`)

Every note written by prunus has YAML frontmatter:

```yaml
---
id: <uuid v4>                    # stable identifier; written once, never changed
summary: <text>                  # 2-3 sentence summary; used for embeddings and search results
created: <ISO 8601>
updated: <ISO 8601>
projects: [project-a, project-b] # grows as more projects reference this note
tags: [tag1, tag2]
---
```

- **`writer.ts`** — per-`(vault, path)` async mutex; concurrent writes to the same file are serialized
- **`watcher.ts`** — `Deno.watchFs` → enqueues `reindex` / `delete` jobs; catches edits made outside the server
- **`see-also.ts`** — manages `## See also` sections in note content
- **Wikilinks** — `[[path/to/note]]` syntax; stored in `links` table; `[[file#section]]` and `[[file|display]]` variants
  are parsed by stripping `#...` and `|...` suffixes
- Startup scan re-queues all notes with null embeddings or model mismatch to recover from embed service downtime

---

## Hybrid Search

Combined vector cosine distance and full-text rank, configurable via `[search]` in `settings.toml`.

```
score = (embedding_distance × vector_weight) + ((1 - ts_rank) × fts_weight)
```

A note is included if it passes the vector gate (cosine distance < `vector_gate`) **or** matches the FTS query. Results
are ranked by ascending score (lower = more relevant).

Defaults: `vector_weight = 0.6`, `fts_weight = 0.4`, `vector_gate = 0.8`, `dedup_threshold = 0.85`.

Embedding is of the `summary` field only — keeps vectors focused and cheap to regenerate.

---

## Profiles (`src/vault/profiles.ts`)

Profile definitions live in `{configDir}/cfg/profiles/{name}.md`. A secret overlay
(`prunus-config-secret/cfg/profiles/`) is also checked.

Vaults enable profiles via symlinks: `{vault}/.profiles/{name}.md → absolute path to profile definition`. The server
combines all enabled profiles' `## Capture` and `## Skip` sections and returns the result from
`GET /vault/{vault}/context`.

If no profile is enabled, the vault is idle — ingest silently returns 0 chunks.

### Profile format

```markdown
---
name: deno-typescript
description: Deno/TypeScript tooling, runtime patterns, JSR ecosystem
---

## Capture

- Runtime and language patterns (Deno APIs, TypeScript idioms, JSR package decisions)
- Dependency choices and the reasoning behind them
- Architecture tradeoffs discovered during implementation

## Skip

- Project-specific business logic
- One-off bug fixes with no generalizable lesson
- Anything already well-documented in official docs
```

---

## Client (`src/cli/`)

Installed on each client machine. No local daemon, no local database.

**Client config:** `~/.prunus/settings.json` (user) + `.prunus/settings.json` walk-up (project). Project settings
override user settings for `vault`, `enabled`, and `project`. `serverUrl` and `authToken` come only from user settings.

```json
{
  "serverUrl": "http://prunus-host:9100",
  "authToken": "...",
  "vault": "code",
  "enabled": true,
  "markerTtlDays": 30
}
```

**Markers:** `~/.prunus/markers/{session_id}.last-ingested` — track the last-ingested position per session for delta
ingest. Markers older than `markerTtlDays` are swept at the start of each ingest call.

### Supported Tools

| Tool        | Hook type                                                                         |
| ----------- | --------------------------------------------------------------------------------- |
| Claude Code | Deno TS hooks (`UserPromptSubmit`, `Stop`, `PreCompact`)                          |
| Gemini CLI  | Deno TS hooks (`BeforeAgent`, `SessionEnd`, `PreCompress`)                        |
| Qwen-Code   | Deno TS hooks (`UserPromptSubmit`, `SessionEnd`, `PreCompact`)                    |
| OpenCode    | TS plugin (`session.idle`, `experimental.session.compacting`, `system.transform`) |

### Client Hook Flow

```
                  Claude Code          Gemini CLI           OpenCode              Qwen-Code
                  -----------          ----------           --------              ---------
First turn:       UserPromptSubmit  →  BeforeAgent       →  system.transform  →  UserPromptSubmit
                  additionalContext     additionalContext     (every LLM call)     additionalContext

Pre-compact:      PreCompact        →  PreCompress        →  session.          →  PreCompact
                  POST /ingest          POST /ingest           compacting            POST /ingest
                  write marker          write marker           (context inject)      write marker

Session end:      Stop              →  SessionEnd         →  session.idle      →  SessionEnd
                  POST /ingest          POST /ingest           POST /ingest          POST /ingest
                  write marker          write marker           write marker          write marker
```

Notes:

- Context injection fires on **every** prompt submit (not first-turn only), passing prompt text as `?query=` to
  `GET /vault/{vault}/context`
- Ingest sends only the delta since the last marker (not the full transcript)
- Claude Code `Stop` and OpenCode `session.idle` fire after every response turn; the per-session marker prevents
  reprocessing
- Gemini CLI and Qwen-Code wrap `additionalContext` in their respective escaping formats; hooks use `[prunus]` bracket
  format (not `<prunus>` XML) to avoid HTML-escape issues
- OpenCode ingest uses `client.session.messages()` SDK call; no transcript file needed
- OpenCode `system.transform` fires every LLM call; combined profile is cached per plugin instance

### MCP Config Entry (written by install script)

```json
{
  "prunus": {
    "type": "http",
    "url": "http://prunus-host:9100/mcp",
    "headers": {
      "Authorization": "Bearer <token>"
    }
  }
}
```

MCP transport type varies by tool: Claude Code uses `type:"http"`, Gemini CLI and Qwen-Code use `httpUrl`, OpenCode uses
`type:"remote"`.

---

## LLM Layer (`src/llm/`)

All LLM calls go to an OpenAI-compatible endpoint configured in `[llm]`.

- **`chat.ts`** — `POST /v1/chat/completions` with full `tool_calls` support
- **`embed.ts`** — `POST /v1/embeddings`
- **`agent.ts`** — agentic loop: runs `chatWithTools`, dispatches tool calls, loops until `finish()` is called or max
  steps reached. Used by `prune` and `shape` jobs.
