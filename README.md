# prunus

A shared knowledge store for LLM coding sessions. Insights, patterns, and architectural decisions accumulate in plain
Markdown vaults and are exposed via MCP for retrieval during future sessions.

Session transcripts are automatically processed by a local LLM at session end — notes are extracted, deduplicated, and
saved without manual intervention.

## How it works

```
Session ends
  └─ Stop hook sends transcript to prunus server
       └─ Server calls local LLM: "what's worth saving?"
            └─ Dedup check against existing vault
                 └─ Auto-save as Markdown → index → available for future sessions
```

On the next session, the UserPromptSubmit hook injects the vault profile as context. Claude then calls `search_notes` or
`read_note` via MCP when it needs specific knowledge.

## Architecture

| Component                 | Role                                                                            |
| ------------------------- | ------------------------------------------------------------------------------- |
| **Deno HTTP server**      | MCP at `/mcp`, ingest at `/vaults/{vault}/ingest`, health/context endpoints     |
| **SQLite** (default)      | Metadata + FTS5 + JS-side cosine similarity — zero external dependencies        |
| **PostgreSQL + pgvector** | Optional — HNSW index + generated TSVECTOR for larger deployments               |
| **OpenAI-compatible API** | Embed model for search; chat model for note extraction (e.g. Ollama, LM Studio) |
| **Vault directories**     | Source of truth — one subdirectory per named vault under `vault.path`           |

The database is derived from the vault and fully rebuildable by rescanning. Source of truth is always the Markdown
files.

## MCP Tools

| Tool             | Description                                                 |
| ---------------- | ----------------------------------------------------------- |
| `search_notes`   | Hybrid vector + FTS search across all notes in the vault    |
| `read_note`      | Read a note's full Markdown content                         |
| `create_note`    | Save a note, merge project history, enqueue for indexing    |
| `update_note`    | Update content without changing identity or project history |
| `delete_note`    | Delete a note from vault and index                          |
| `suggest_links`  | Suggest existing notes for `[[wikilinks]]`                  |
| `list_vaults`    | List available vault names                                  |
| `create_vault`   | Create a new named vault directory                          |
| `delete_vault`   | Delete a vault and all its contents                         |
| `list_profiles`  | List profiles in a vault                                    |
| `create_profile` | Create a new profile file                                   |
| `update_profile` | Update an existing profile file                             |
| `delete_profile` | Delete a profile file                                       |

## Setup

### Server

```sh
# SQLite (default — no other services needed)
cp settings-dev.toml settings.toml
# edit settings.toml: set vault.path, llm.hostname, llm.chat.model, llm.embed.model
deno task dev
```

For PostgreSQL, set `db.type = "postgres"` and fill in the `[db.postgres]` section.

### Client (Claude Code)

```sh
cd client
./install.sh
# prompts for server URL, default vault, auth token
# installs hooks and patches ~/.claude/settings.json
```

Per-project vault override — add to `.prunus/settings.json` in the project root:

```json
{
  "vault": "myproject"
}
```

### MCP server config

Add to Claude Code (or any MCP client):

```json
{
  "mcpServers": {
    "prunus": {
      "type": "http",
      "url": "http://<host>:9100/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

## Settings (`settings.toml`)

`settings.toml` is a symlink → `settings-dev.toml`. Use `PRUNUS_ENV=test` to load `settings-test.toml`.

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
path = "/path/to/prunus.db"

# [db.postgres]
# hostname = "..." port = 5432 database = "prunus" user = "..." password = "..."

[llm]
hostname = "localhost"
port = 1234

[llm.chat]
model = "..."   # chat model for note extraction (e.g. qwen2.5, llama3.2)

[llm.embed]
model = "..."          # embedding model (e.g. nomic-embed-text, bge-m3)
dimension = 1024       # must match model

[vault]
path = "/path/to/vaults"   # required; each subdirectory is a named vault

# [search]
# vector_weight = 0.6  fts_weight = 0.4  vector_gate = 0.8  dedup_threshold = 0.85
```

## Client Settings

Client hooks read JSON config (no `.env` files). Settings are layered:

- `~/.prunus/settings.json` — user-level (serverUrl, authToken, default vault, profile, markerTtlDays)
- `.prunus/settings.json` (walk up from cwd) — project-level (vault, enabled, project, profile)

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

The `profile` field is optional. When set, the hook fetches the named profile from `{vault}/.prunus/profiles/{name}.md`
and injects it as context at session start. Profiles are off by default.

## Development

```sh
deno task dev     # run with hot reload
deno task fmt     # format
deno task lint    # lint
deno task check   # type check
deno task test    # tests
```

## Vault format

Notes are plain Markdown with YAML frontmatter managed by the server:

```markdown
---
id: <uuid>
summary: '2-3 sentence summary used for search and embeddings'
created: 2026-03-23T10:00:00Z
updated: 2026-03-23T10:00:00Z
projects:
  - my-app
  - other-app
tags:
  - typescript
---

Note content here...
```

Vaults are Obsidian-compatible — `[[wikilinks]]` between notes are stored as link relationships in the index.

All notes in a vault are always searchable — there is no per-project filtering.
