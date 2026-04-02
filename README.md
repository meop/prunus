# prunus

A shared knowledge store for AI coding sessions. Insights, decisions, and patterns accumulate in plain Markdown trees
and are surfaced via MCP during future sessions across all your machines and tools.

## How it works

**Capturing knowledge** — explicit, curated:

```
/prunus update "focus on the architectural decisions"
  └─ Session AI composes a summary document from the current session context
       └─ Sends document to prunus via update_notes MCP tool
            └─ Server LLM extracts distinct knowledge chunks from the document
                 └─ Dedup check against existing tree → save as Markdown → index
```

**Using knowledge** — automatic, per-prompt:

```
User sends a prompt
  └─ Hook/plugin queries prunus: GET /tree/{tree}/context?query=<prompt>
       └─ Relevant note summaries injected as context
            └─ Session AI calls read_note or search_notes via MCP for full content
```

## Architecture

| Component                 | Role                                                                            |
| ------------------------- | ------------------------------------------------------------------------------- |
| **Deno HTTP server**      | MCP at `/mcp`, context search at `/tree/{tree}/context`, health endpoint        |
| **SQLite** (default)      | Metadata + FTS5 + JS-side cosine similarity — zero external dependencies        |
| **PostgreSQL + pgvector** | Optional — HNSW index + TSVECTOR for larger deployments                         |
| **OpenAI-compatible API** | Embed model for search; chat model for note extraction (e.g. Ollama, LM Studio) |
| **Tree directories**      | Source of truth — one subdirectory per named tree under `grove.path`            |

The database is derived from the grove and fully rebuildable by rescanning.

## MCP Tools

| Tool              | Description                                                   |
| ----------------- | ------------------------------------------------------------- |
| `create_note`     | Create a new note at a given path                             |
| `read_note`       | Read a note's full Markdown content by path or ID             |
| `update_note`     | Update an existing note's body and summary                    |
| `delete_note`     | Delete a note; watcher handles link cleanup and index removal |
| `list_notes`      | List all note paths in a tree                                 |
| `search_notes`    | Hybrid vector + FTS search across all notes in the tree       |
| `update_notes`    | Submit a prepared session summary document for LLM extraction |
| `list_profiles`   | List all profiles + which are enabled for a tree              |
| `enable_profile`  | Enable a profile for a tree                                   |
| `disable_profile` | Disable a profile for a tree                                  |

## Setup

### Server

```sh
cp settings-dev.toml settings.toml
# edit settings.toml: set grove.path, llm.hostname, llm.chat.model, llm.embed.model
deno task start
```

For PostgreSQL, set `db.type = "postgres"` and fill in the `[db.postgres]` section.

### Clients

Supports Claude Code, Gemini CLI, OpenCode, and Qwen-Code. The installer detects which are installed:

```sh
deno run --allow-all http://prunus-host:9100/cli/install
```

Installs per tool: MCP server registration, per-prompt context hook, `/prunus` slash command.

Then in any project:

```sh
/prunus init   # creates .prunus/settings.json, sets tree and project
```

See `CLIENTS.md` for per-tool details, hook formats, and settings.

## Server Settings (`settings.toml`)

```toml
[srv]
hostname = "0.0.0.0"
port = 9100

[srv.auth]
token = ""

[log]
level = "info"   # debug | info | warn | error

[db]
type = "sqlite"   # sqlite | postgres

[db.sqlite]
path = "/path/to/data"

[llm]
hostname = "localhost"
port = 1234

[llm.chat]
model = "..."   # chat model for note extraction (e.g. qwen2.5, llama3.2)

[llm.embed]
model = "..."          # embedding model (e.g. nomic-embed-text, bge-m3)
dimension = 1024       # must match model

[grove]
path = "/path/to/trees"   # required; each subdirectory is a named tree
```

## Client Settings

- `~/.prunus/settings.json` — user-level: `url`, `token`, default `tree`
- `.prunus/settings.json` — project-level (walk-up from cwd): `tree`, `enabled`, `project`

## Note Format

Notes are plain Markdown with YAML frontmatter managed by the server:

```markdown
---
id: <uuid>
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

## Development

```sh
deno task check   # type check
deno task format  # format
deno task lint    # lint
deno task start   # run with hot reload
deno task test    # tests
```
