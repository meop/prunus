# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Setup

This repository requires sibling repositories to be cloned:

```bash
cd /your/workspace
mkdir @prunus && cd @prunus
git clone <your-prunus-repo-url> prunus
git clone <your-prunus-config-repo-url> prunus-config
git clone <your-prunus-config-secret-repo-url> prunus-config-secret  # Private, optional
```

Expected directory structure:

```
@prunus/
├── prunus/                  (this repo)
├── prunus-config/           (profile definitions, public)
└── prunus-config-secret/    (private profiles, optional)
```

**Dependencies:**

- **prunus-config** — capture profile definitions (`cfg/profiles/*.md`), loaded by the server
- **prunus-config-secret** — private capture profiles (optional, overlays prunus-config)

## Project

A centralized knowledge store exposed via MCP over HTTP. Clients (Claude Code instances on multiple machines) connect to
a single shared server to read and write curated insights. The server auto-extracts insights from session transcripts
via a local LLM (OpenAI-compatible).

See `docs/DESIGN.md` for full architecture and component boundaries.

## Development Commands

```bash
deno task dev             # development mode with hot reload
deno task fmt             # apply formatting (modifies files)
deno task fmt:check       # verify formatting without modifying (CI / pre-commit)
deno task lint            # lint
deno task check           # type check
deno task test            # run tests
```

### After Every Change

Run in this order:

1. `deno task fmt` — apply formatting; always modifies files if needed
2. `deno task lint` — check for lint errors; if found, fix and return to step 1
3. `deno task check` — type check

## Code Formatting

Deno formatting rules (deno.json):

- No semicolons
- Single quotes
- Trailing commas only on multiline
- Line width: 120

### Import Sorting

Imports must be organized into 3 levels with a single empty line between each level, and sorted alphabetically within
each category:

1. External packages (e.g., `@std/*`, `@db/*`, `@modelcontextprotocol/*`, `npm:*`)
2. Local project files (e.g., `./config.ts`, `../log.ts`)

Example:

```typescript
import { join } from '@std/path'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

import { config } from '../config.ts'
import { log } from '../log.ts'
```

### Code Style

- Always use curly braces for `if` statement bodies, with body on next line
- No comments unless explicitly asked
- No `node_modules` — Deno imports from JSR or npm: specifiers

## Runtime

**Deno** — not Bun. All APIs must use Deno equivalents.

- `Deno.serve()` — not `Bun.serve()` or Express
- `Deno.readTextFile` / `Deno.writeTextFile` — not `Bun.file` or `node:fs`
- `Deno.watchFs()` — not `node:fs` watch
- `jsr:@db/postgres` for Postgres, `jsr:@db/sqlite` for SQLite
- Config is read from `settings.toml` (symlink → `settings-dev.toml`); use `PRUNUS_ENV=test` for tests
- `deno test` — not Jest, Vitest, or `bun test`

## Key Conventions

- DB backend: `db.type = "sqlite"` (default) or `"postgres"` in `settings.toml` — selected at startup via
  `src/db/index.ts`
- Store interface in `src/db/store.ts` — both backends implement it; no SQL leaks into tools or routes
- SQLite backend auto-downloads `sqlite-vec` native extension on first startup (cached in `.sqlite/`)
- MCP endpoint: `POST /mcp` (StreamableHTTP, bearer token auth)
- Ingest endpoint: `POST /vault/{vault}/ingest` — receives session transcript, auto-saves insights
- Health: `GET /health` (public, no auth); probe: `GET /` (no auth)
- Vault path is always relative within `config.vault.base` — no absolute path construction outside `src/vault/`
- All notes in a vault are always searchable — there is no project-based search filtering

## Source Layout

```
src/
  srv.ts              # Entry — Deno.serve(), all routes
  settings.ts         # TOML settings loader (settings.toml / settings-{env}.toml)
  config.ts           # Typed config object derived from settings
  health.ts           # GET /health handler (db, embed service, queue status)
  log.ts              # Structured logger
  auth.ts             # Bearer token middleware
  queue.ts            # Async embed+index pipeline — all writes flow through here

  db/
    store.ts          # Store interface — both backends implement this
    pg.ts             # Postgres implementation (pgvector, HNSW, TSVECTOR)
    sqlite.ts         # SQLite implementation (sqlite-vec native vectors, JS cosine fallback)
    index.ts          # Factory: createStore() based on db.type setting

  llm/
    chat.ts           # POST /v1/chat/completions to OpenAI-compat endpoint
    embed.ts          # POST /v1/embeddings to OpenAI-compat endpoint

  ingest/
    index.ts          # Transcript → LLM extraction → dedup → auto-save

  vault/
    parser.ts         # Frontmatter parse/serialize, wikilink extraction, content hash
    reader.ts         # readNote(vault, path) → ParsedNote
    writer.ts         # writeNote with per-path async mutex
    watcher.ts        # Deno.watchFs → enqueue jobs
    profiles.ts       # Load+combine enabled profiles from {vault}/.profiles/ symlinks

  mcp/
    server.ts
    transport.ts      # Stateless RequestTransport for Deno.serve
    tools/
      index.ts
      note/
        search_notes.ts
        read_note.ts
        create_note.ts
        update_note.ts
        delete_note.ts
        suggest_links.ts
      vault/
        list_vaults.ts
        create_vault.ts
        delete_vault.ts
      profile/
        list_profiles.ts
        enable_profile.ts
        disable_profile.ts

src/cli/                # Installed on each client machine; config lives in ~/.prunus/
  install.ts            # Unified installer — prompts for tool, branches per tool
  prunus.md             # /prunus command (source; transformed per tool at install time)
  hooks/
    mod.ts              # Shared Deno hook utilities (loadSettings, parseTranscript, runIngest, sweepMarkers, …)
    deno.json           # Deno config for hooks
    claude-code/
      user-prompt-submit.ts  # First-turn context injection
      stop.ts                # Session-end ingest
      pre-compact.ts         # Pre-compaction ingest + last-ingested marker
    gemini-cli/
      before-agent.ts        # First-turn context injection (BeforeAgent event)
      session-end.ts         # Session-end ingest (SessionEnd event)
      pre-compress.ts        # Pre-compression ingest (PreCompress event)
    opencode/
    qwen-code/
      user-prompt-submit.ts  # First-turn context injection (hookSpecificOutput.additionalContext)
      session-end.ts         # Session-end ingest (SessionEnd event, fires once on exit)
      pre-compact.ts         # Pre-compaction ingest + marker
  plugins/
    opencode/
      prunus.ts              # TS plugin: ingest on session.idle; context inject at experimental.session.compacting
```

## HTTP Routes

```
GET  /                             probe (no auth)
GET  /health                       {status, db, embed_service, queue_depth} (public, no auth)
GET  /cli/{path}                   serve client install files (no auth)
GET  /vault/{vault}/context        ?query=<text> → {notes:[{path,summary}]} — relevant notes via hybrid search
POST /vault/{vault}/ingest         {project, transcript, since?} → {saved, skipped}
POST /mcp                          MCP JSON-RPC endpoint
```

Install on a client machine:

```sh
deno run --allow-all http://prunus-host:9100/cli/install
```

## Database Schema (both backends)

**`notes`** — one row per Markdown file `id` · `vault` · `path` · `summary` · `projects[]` · `embed` · `embed_model` ·
`content_hash` · `fts` · `metadata` · timestamps

**`links`** — resolved wikilinks between notes `source_id` · `target_id` · `type` (default: `wikilink`)

Source of truth is always the Markdown files. The DB is derived and fully rebuildable.

## Settings (`settings.toml`)

`settings.toml` is a symlink → `settings-dev.toml`. Use `PRUNUS_ENV=test` to load `settings-test.toml`.

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
path = "/vol/note/prunus/data"

# [db.postgres]
# hostname = "..." port = 5432 database = "prunus" user = "..." password = "..."

[llm]
hostname = "arch.lan"
port = 1234

[llm.chat]
model = "..."

[llm.embed]
model = "..."
dimension = 1024   # must match model

[vault]
path = "/data/note/prunus"   # required
# configDir = "/path/to/prunus-config"   # optional; defaults to sibling prunus-config/ dir

# [search]
# vector_weight = 0.6  fts_weight = 0.4  vector_gate = 0.8  dedup_threshold = 0.85
```

## Client Settings (`~/.prunus/settings.json`)

Client hooks read JSON from `~/.prunus/settings.json` (user) and `.prunus/settings.json` (project, walk-up). Project
settings override user settings for `vault`, `enabled`, and `project`. `serverUrl` and `authToken` come only from user
settings.

```json
{
  "serverUrl": "http://prunus-host:9100",
  "authToken": "...",
  "vault": "code",
  "enabled": true,
  "markerTtlDays": 30
}
```

- `markerTtlDays` — marker files older than this are deleted at the start of each `runIngest` call (default: 30).
- Marker files: `~/.prunus/markers/{session_id}.last-ingested`

## Profile System

Profile definitions live in `{configDir}/cfg/profiles/{name}.md` (configurable via `vault.configDir` in `settings.toml`,
defaults to sibling `prunus-config/` directory). The secret overlay (`prunus-config-secret/cfg/profiles/`) is also
checked — profiles from either source can be enabled.

Vaults enable profiles via symlinks in `{vault}/.profiles/{name}.md → absolute path to profile definition`. The combined
profile is used by the ingest LLM to filter what's worth capturing. Clients do not receive profiles — the context
endpoint returns relevant notes instead.

Profiles are managed server-side (not via MCP writes). MCP tools: `list_profiles` (shows all profiles + which are
enabled), `enable_profile` (create symlink), `disable_profile` (remove symlink). Client settings do not have a `profile`
field — enabling is done server-side via MCP or direct symlink management.

## MCP Tools

| Tool              | Description                                              |
| ----------------- | -------------------------------------------------------- |
| `search_notes`    | Hybrid vector + FTS search across all notes in the vault |
| `read_note`       | Read a note's full Markdown content                      |
| `list_vaults`     | List available vault names                               |
| `create_vault`    | Create a new named vault directory                       |
| `delete_vault`    | Delete a vault and all its contents                      |
| `list_profiles`   | List all profiles + which are enabled for a vault        |
| `enable_profile`  | Enable a profile for a vault (create symlink)            |
| `disable_profile` | Disable a profile for a vault (remove symlink)           |

## Client Hook Flow

```
                  Claude Code          Gemini CLI           OpenCode              Qwen-Code
                  -----------          ----------           --------              ---------
Per prompt:       UserPromptSubmit  →  BeforeAgent       →  experimental.chat. →  UserPromptSubmit
                  {additionalContext}   {hookSpecificOutput    system.transform       {hookSpecificOutput
                                        .additionalContext}   (every LLM call)       .additionalContext}

Pre-compact:      PreCompact        →  PreCompress        →  experimental.     →  PreCompact
                  POST /ingest          POST /ingest           session.compacting      POST /ingest
                  write marker          write marker           (context inject only)   write marker

Session end:      Stop              →  SessionEnd         →  event: session.idle →  SessionEnd
                  POST /ingest          POST /ingest           POST /ingest           POST /ingest
                  write marker          write marker           write marker           write marker

Settings file:    ~/.claude/           ~/.gemini/           ~/.config/opencode/    ~/.qwen/
                  settings.json        settings.json        opencode.json (mcp key) settings.json

MCP transport:    type:"http"          httpUrl              type:"remote"          httpUrl

Notes:
- Gemini CLI wraps additionalContext in <hook_context> tags and HTML-escapes <> in content
- Qwen-Code HTML-escapes <> in additionalContext content
- Both use [prunus] bracket format (not <prunus> XML) to avoid escaping
- OpenCode auto-discovers plugins from ~/.config/opencode/plugins/*.ts
- Claude Code Stop and OpenCode session.idle fire after every response turn (not just session end)
  — per-session marker prevents reprocessing; only delta since last ingest is sent each time
- OpenCode ingest uses client.session.messages() SDK call (no transcript file needed)
- OpenCode system.transform fires every LLM call (not first-turn only); relevant notes fetched per prompt via the context endpoint
```
