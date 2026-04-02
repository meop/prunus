# CLAUDE.md

## Project

A centralized knowledge store exposed via MCP over HTTP. Clients (AI coding assistants on multiple machines) connect to
a single shared server to read and write curated insights.

Knowledge is captured explicitly: the client AI composes a summary document from the current session at a meaningful
moment and sends it via the `update_tree` MCP tool. The server's LLM then extracts, deduplicates, and saves notes from
that prepared document. On each prompt, a per-prompt hook queries the server for relevant notes and injects their
summaries as context so the session AI knows what to look up via MCP.

See `docs/CLIENTS.md` for all client-specific details (hook events, plugin API, install, settings file locations).

## Naming (Arborist Metaphor)

| Term    | Meaning                                                           |
| ------- | ----------------------------------------------------------------- |
| grove   | The root directory that holds all trees                           |
| tree    | A named knowledge domain within the grove — has notes and profiles |
| note    | A single Markdown file within a tree                              |
| grow    | LLM agent integrating a new knowledge chunk into a tree           |
| shape   | LLM agent reorganizing a whole tree (periodic, every N grows)     |
| heal    | LLM agent propagating a change to related notes                   |
| prune   | Mechanical removal of a note and its dead links from a tree       |
| survey  | Mechanical re-embed + upsert DB + resolve wikilinks for a note    |
| profile | Capture criteria — tells the updateTree LLM what is worth keeping |

## Development Commands

```bash
deno task check           # type check
deno task format          # apply formatting (modifies files)
deno task format:check    # verify formatting without modifying (CI / pre-commit)
deno task lint            # lint
deno task start           # development mode with hot reload
deno task start:systemd   # start via systemd
deno task stop:systemd    # stop via systemd
deno task test            # run tests
```

### After Every Change

Run in this order:

1. `deno task format` — apply formatting; always modifies files if needed
2. `deno task lint` — check for lint errors; if found, fix and return to step 1
3. `deno task check` — type check

## Code Formatting

Deno formatting rules (deno.json):

- No semicolons
- Single quotes
- Trailing commas only on multiline
- Line width: 120

### Import Sorting

Imports must be organized into groups with a single empty line between each group, and sorted alphabetically by source
within each group:

1. External packages (e.g., `@db/*`, `@modelcontextprotocol/*`, `@std/*`, `npm:*`, `zod`)
2. Local project files (e.g., `./stng.ts`, `../log.ts`)

Example:

```typescript
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { join } from '@std/path'
import { z } from 'zod'

import { SETTINGS } from '../stng.ts'
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
- DB backend: `db.type = "sqlite"` (default) or `"postgres"` — selected at startup via `src/db/index.ts`
- Store interface in `src/db/store.ts` — both backends implement it; no SQL leaks into tools or routes
- SQLite backend auto-downloads `sqlite-vec` native extension on first startup (cached in db path)
- MCP endpoint: `POST /mcp` (StreamableHTTP, bearer token auth)
- Health: `GET /health` (public, no auth); probe: `GET /` (no auth)
- Note path is always relative within `SETTINGS.grove.path` — no absolute path construction outside `src/tree/`
- All notes in a tree are always searchable — there is no project-based search filtering

## Source Layout

```
src/
  auth.ts             # Bearer token middleware
  cfg.ts              # Profile directory paths derived from cfg.dirs
  health.ts           # GET /health handler (db, embed service, queue status)
  log.ts              # Structured logger
  queue.ts            # Async job pipeline — all writes flow through here
  srv.ts              # Entry — Deno.serve(), all routes
  stng.ts             # TOML settings loader with defaults

  db/
    index.ts          # getStore() / initStore() — selects backend from db.type
    pg.ts             # PostgreSQL + pgvector + HNSW + TSVECTOR
    store.ts          # Store interface — both backends implement this
    sqlite.ts         # SQLite + sqlite-vec native extension (JS cosine fallback)

  llm/
    agent.ts          # Agentic loop — chatWithTools, tool dispatch, loop until finish()
    chat.ts           # POST /v1/chat/completions (OpenAI-compat, tool_calls support)
    embed.ts          # POST /v1/embeddings (OpenAI-compat)

  ingest/
    index.ts          # updateTree() — prepared document → LLM extraction → grow jobs

  tree/
    parser.ts         # Frontmatter parse/serialize, wikilink extraction, content hash
    profiles.ts       # Load+combine enabled profiles from {tree}/.profiles/ symlinks
    reader.ts         # readNote(tree, path) → ParsedNote
    related.ts        # "See also" section — get/add/remove cross-reference wikilinks
    tools.ts          # LLM agent tool definitions (search_notes, read_note, write_note, delete_note, finish)
    watcher.ts        # Deno.watchFs → enqueue jobs
    writer.ts         # writeNote with per-path async mutex

  mcp/
    server.ts
    tools/
      index.ts
      tree/
        create.ts
        delete.ts
        list.ts
        read.ts            # tool name: read_note
        search.ts          # tool name: search_notes
        update.ts          # update_tree MCP tool — fire-and-forget → ingest pipeline
      profile/
        disable.ts
        enable.ts
        list.ts
    transport.ts      # Stateless RequestTransport for Deno.serve

src/cli/                # Installed on each client machine; config lives in ~/.prunus/
  install.ts            # Unified installer — prompts for tool, branches per tool
  prunus.md             # /prunus slash command (source; transformed per tool at install time)
  hooks/
    mod.ts              # Shared Deno hook utilities (loadSettings, fetchContext, runContextHook)
    deno.json           # Deno import map for hooks
    claude-code/
      user-prompt-submit.ts  # Per-prompt context injection (UserPromptSubmit)
    gemini-cli/
      before-agent.ts        # Per-prompt context injection (BeforeAgent)
    qwen-code/
      user-prompt-submit.ts  # Per-prompt context injection (UserPromptSubmit)
  plugins/
    opencode/
      prunus.ts              # Bun plugin: per-prompt context injection (chat.message + system.transform)
```

## HTTP Routes

```
GET  /                           probe (no auth)
GET  /cli/{path}                 serve client install files (no auth)
GET  /health                     {status, db, embed_service, queue_depth} (public, no auth)
GET  /tree/{tree}/context        ?query=<text> → {notes:[{path,summary}]} — relevant notes via hybrid search
POST /mcp                        MCP JSON-RPC endpoint (StreamableHTTP, bearer token auth)
```

Install on a client machine:

```sh
deno run --allow-all http://prunus-host:9100/cli/install
```

## MCP Tools

| Tool              | Description                                                   |
| ----------------- | ------------------------------------------------------------- |
| `update_tree`     | Submit a prepared session summary document for LLM extraction |
| `search_notes`    | Hybrid vector + FTS search across all notes in the tree       |
| `read_note`       | Read a note's full Markdown content by path or ID             |
| `list_trees`      | List available tree names                                     |
| `create_tree`     | Create a new named tree directory                             |
| `delete_tree`     | Delete a tree and all its contents                            |
| `list_profiles`   | List all profiles + which are enabled for a tree              |
| `enable_profile`  | Enable a profile for a tree (creates symlink)                 |
| `disable_profile` | Disable a profile for a tree (removes symlink)                |

`update_tree` is fire-and-forget — returns `"Document received."` immediately and processes asynchronously via the queue.

## Settings

Settings are loaded from `settings.toml` (symlink → `settings-dev.toml`; use `PRUNUS_ENV=test` for tests). Schema and defaults are defined in `src/stng.ts`.

## Client Settings

Client hooks read JSON from `~/.prunus/settings.json` (user-level) and `.prunus/settings.json` (project-level, walked up
from cwd). Project settings override user settings for `tree`, `enabled`, and `project`. `url` and `token` come only
from user settings.

Fields: `url` · `token` · `tree` · `enabled` (default `true`) · `project` (default: directory name)

Settings walk: hooks walk up from cwd collecting all `.prunus/settings.json` files — the deepest file wins for each key.
If the deepest file sets `"enabled": false`, the walk stops immediately.

## Profile System

Profile definitions live in `cfg/profiles/{name}.md` within the config directories specified by `cfg.dirs` in `settings.toml`.

Trees enable profiles via symlinks in `{tree}/.profiles/{name}.md → absolute path to profile definition`. The combined
profile is passed to the `updateTree` LLM to filter what knowledge is worth extracting from submitted documents. If no
profile is enabled, the tree is idle — updateTree silently extracts nothing.

Profiles are managed server-side. MCP tools: `list_profiles`, `enable_profile`, `disable_profile`.

## Note Format

```markdown
---
id: <uuid v4>
summary: '2-3 sentence summary used for search and embeddings'
created: 2026-03-23T10:00:00Z
updated: 2026-03-23T10:00:00Z
projects:
  - my-app
tags:
  - typescript
---

Note content here...
```

Trees are Obsidian-compatible — `[[wikilinks]]` between notes are stored as link relationships in the index.
`[[file#section]]` and `[[file|display]]` variants are parsed by stripping `#...` and `|...` suffixes.

## Hybrid Search

```
score = (embedding_distance × vector weight) + ((1 - ts_rank) × fts weight)
```

A note is included if it passes the vector gate (cosine distance < vector gate) **or** matches the FTS query. Results
ranked by ascending score (lower = more relevant). Embedding is of the `summary` field only.

Defaults: vector weight `0.6`, fts weight `0.4`, vector gate `0.8`, dedup threshold `0.85`.

## Known Gaps

1. **Stale DB records on startup** — notes deleted while the server was offline leave orphaned DB rows. The initial scan
   only enqueues `survey` for existing files; it never compares DB contents against the filesystem to detect removals.

2. **Dead link re-resolution** — when note A contains `[[B]]` and B does not exist at index time, the link is not
   stored. When B is later created, A's `[[B]]` is never retroactively resolved unless A is surveyed again.

3. **Profile change does not re-trigger grow** — enabling a new profile does not retroactively re-process documents
   submitted under old criteria.

4. **Embed model drift mid-session** — `surveyStaleNotes` handles stale embeddings after a model change at startup,
   but not if the model is changed while the server is running.
