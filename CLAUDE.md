# prunus — Claude Code Context

## Project

A centralized knowledge store exposed via MCP over HTTP. Clients (Claude Code instances on multiple machines) connect to
a single shared server to read and write curated insights. The server auto-extracts insights from session transcripts
via a local LLM (OpenAI-compatible).

See `docs/DESIGN.md` for full architecture and component boundaries.

## Runtime

**Deno** — not Bun. All APIs must use Deno equivalents.

- `Deno.serve()` — not `Bun.serve()` or Express
- `Deno.readTextFile` / `Deno.writeTextFile` — not `Bun.file` or `node:fs`
- `Deno.watchFs()` — not `node:fs` watch
- `jsr:@db/postgres` for Postgres, `jsr:@db/sqlite` for SQLite
- Config is read from `settings.toml` (symlink → `settings-dev.toml`); use `PRUNUS_ENV=test` for tests
- `deno test` — not Jest, Vitest, or `bun test`

## After Every Change

```sh
deno task fmt    # format all code
deno task lint   # lint
deno task check  # type check
```

## Key Conventions

- DB backend: `db.type = "sqlite"` (default) or `"postgres"` in `settings.toml` — selected at startup via
  `src/db/index.ts`
- Store interface in `src/db/store.ts` — both backends implement it; no SQL leaks into tools or routes
- MCP endpoint: `POST /mcp` (StreamableHTTP, bearer token auth)
- Ingest endpoint: `POST /vaults/{vault}/ingest` — receives session transcript, auto-saves insights
- Health: `GET /health` (auth required); probe: `GET /` (no auth)
- Vault path is always relative within `config.vault.base` — no absolute path construction outside `src/vault/`
- No `node_modules` — Deno imports from JSR or npm: specifiers
- All notes in a vault are always searchable — there is no project-based search filtering

## Source Layout

```
src/
  srv.ts              # Entry — Deno.serve(), all routes
  settings.ts         # TOML settings loader (settings.toml / settings-{env}.toml)
  config.ts           # Typed config object derived from settings
  log.ts              # Structured logger
  auth.ts             # Bearer token middleware
  queue.ts            # Async embed+index pipeline — all writes flow through here

  db/
    store.ts          # Store interface — both backends implement this
    pg.ts             # Postgres implementation (pgvector, HNSW, TSVECTOR)
    sqlite.ts         # SQLite implementation (FTS5, JS-side cosine similarity)
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
    profiles.ts       # loadProfile(vault, name) → reads {vault}/.prunus/profiles/{name}.md

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
        create_profile.ts
        update_profile.ts
        delete_profile.ts

client/                 # Installed on each client machine; config lives in ~/.prunus/
  install.ts            # Unified installer — prompts for tool, branches per tool
  prunus.md             # /prunus command (source; transformed per tool at install time)
  mod.ts                # Shared Deno hook utilities (loadSettings, parseTranscript, runIngest, sweepMarkers, …)
  claude-code/
    hooks/
      user-prompt-submit.ts  # First-turn context injection
      stop.ts                # Session-end ingest
      pre-compact.ts         # Pre-compaction ingest + last-ingested marker
  gemini-cli/
    hooks/
      before-agent.ts        # First-turn context injection (BeforeAgent event)
      session-end.ts         # Session-end ingest (SessionEnd event)
      pre-compress.ts        # Pre-compression ingest (PreCompress event)
  qwen-code/
    hooks/
      user-prompt-submit.ts  # First-turn context injection (hookSpecificOutput.additionalContext)
      session-end.ts         # Session-end ingest (SessionEnd event, fires once on exit)
      pre-compact.ts         # Pre-compaction ingest + marker
  opencode/
    plugins/
      prunus.ts              # TS plugin: ingest on session.idle; context inject at experimental.session.compacting
```

## HTTP Routes

```
GET  /                             probe (no auth)
GET  /health                       {status, db, embed_service, queue_depth}
GET  /install                      redirect to /client/install.ts (no auth)
GET  /client/{path}                serve client install files (no auth)
GET  /vaults/{vault}/context       returns profile for first-turn hook injection
POST /vaults/{vault}/ingest        {project, transcript, since?} → {saved, skipped}
POST /mcp                          MCP JSON-RPC endpoint
```

Install on a client machine:

```sh
deno run --allow-all http://prunus-host:9100/install
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
path = "/vol/note/prunus/prunus.db"

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

# [search]
# vector_weight = 0.6  fts_weight = 0.4  vector_gate = 0.8  dedup_threshold = 0.85
```

## Client Settings (`~/.prunus/settings.json`)

Client hooks read JSON from `~/.prunus/settings.json` (user) and `.prunus/settings.json` (project, walk-up). Project
settings override user settings for `vault`, `enabled`, `project`, and `profile`. `serverUrl` and `authToken` come only
from user settings.

```json
{
  "serverUrl": "http://prunus-host:9100",
  "authToken": "...",
  "vault": "code",
  "enabled": true,
  "profile": "default",
  "markerTtlDays": 30
}
```

- `profile` — optional; names a profile file in `{vault}/.prunus/profiles/{name}.md`. If absent or empty, no profile is
  injected at first turn.
- `markerTtlDays` — marker files older than this are deleted at the start of each `runIngest` call (default: 30).
- Marker files: `~/.prunus/markers/{session_id}.last-ingested`

## Profile System

Profiles are off by default. To enable, set `"profile": "<name>"` in `.prunus/settings.json`. The server reads
`{vault}/.prunus/profiles/{name}.md` via `loadProfile(vault, name)` and returns its content at
`GET /vaults/{vault}/context?profile={name}`. Profiles can be managed with the `create_profile`, `update_profile`,
`list_profiles`, and `delete_profile` MCP tools.

## MCP Tools

| Tool             | Description                                                                  |
| ---------------- | ---------------------------------------------------------------------------- |
| `search_notes`   | Hybrid vector + FTS search across all notes in the vault                     |
| `read_note`      | Read a note's full Markdown content                                          |
| `create_note`    | Save a note, merge project history, enqueue for indexing                     |
| `update_note`    | Update content without changing identity or project history                  |
| `delete_note`    | Delete a note from vault and index                                           |
| `suggest_links`  | Suggest existing notes for `[[wikilinks]]` (renamed from get_relevant_links) |
| `list_vaults`    | List available vault names                                                   |
| `create_vault`   | Create a new named vault directory                                           |
| `delete_vault`   | Delete a vault and all its contents                                          |
| `list_profiles`  | List profiles in a vault                                                     |
| `create_profile` | Create a new profile file                                                    |
| `update_profile` | Update an existing profile file                                              |
| `delete_profile` | Delete a profile file                                                        |

## Client Hook Flow

```
                  Claude Code          Gemini CLI           Qwen-Code            OpenCode
                  -----------          ----------           ---------            --------
First turn:       UserPromptSubmit  →  BeforeAgent       →  UserPromptSubmit  →  experimental.chat.
                  {additionalContext}   {hookSpecificOutput  {hookSpecificOutput    system.transform
                                        .additionalContext}   .additionalContext}   (every LLM call)

Pre-compact:      PreCompact        →  PreCompress        →  PreCompact       →  experimental.
                  POST /ingest          POST /ingest           POST /ingest        session.compacting
                  write marker          write marker           write marker        (context inject only)

Session end:      Stop              →  SessionEnd         →  SessionEnd       →  event: session.idle
                  POST /ingest          POST /ingest           POST /ingest        POST /ingest
                  write marker          write marker           write marker        write marker

Settings file:    ~/.claude/           ~/.gemini/           ~/.qwen/             ~/.config/opencode/
                  settings.json        settings.json        settings.json        opencode.json (mcp key)

MCP transport:    type:"http"          httpUrl              httpUrl              type:"remote"

Notes:
- Gemini CLI wraps additionalContext in <hook_context> tags and HTML-escapes <> in content
- Qwen-Code HTML-escapes <> in additionalContext content
- Both use [prunus] bracket format (not <prunus> XML) to avoid escaping
- OpenCode auto-discovers plugins from ~/.config/opencode/plugins/*.ts
- Claude Code Stop and OpenCode session.idle fire after every response turn (not just session end)
  — per-session marker prevents reprocessing; only delta since last ingest is sent each time
- OpenCode ingest uses client.session.messages() SDK call (no transcript file needed)
- OpenCode system.transform fires every LLM call (not first-turn only); profile cached per plugin instance
```
