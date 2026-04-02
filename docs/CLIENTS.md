# Clients

Client-side integration details for all supported AI coding tools. See `CLAUDE.md` for server architecture, MCP tools,
and settings schema.

## Overview

Each client does two things:

1. **Context injection** — on every user prompt, a hook/plugin queries `/tree/{tree}/context?query=<prompt>` and injects
   matching note summaries as additional context. The session AI can then call `read_note` or `search_notes` via MCP to
   retrieve full content.

2. **Knowledge capture** — the user explicitly invokes `/prunus ingest [guidance]` at a meaningful point in the session.
   The session AI composes a curated summary document (capturing conclusions, decisions, validated approaches — not dead
   ends or abandoned attempts) and sends it to prunus via the `contribute` MCP tool. The server LLM extracts and files
   the knowledge.

## Feature Matrix

|                        | Claude Code                                                | Gemini CLI                             | OpenCode                                | Qwen-Code                              |
| ---------------------- | ---------------------------------------------------------- | -------------------------------------- | --------------------------------------- | -------------------------------------- |
| **Context hook event** | `UserPromptSubmit`                                         | `BeforeAgent`                          | `chat.message` + `system.transform`     | `UserPromptSubmit`                     |
| **Hook output field**  | `additionalContext`                                        | `hookSpecificOutput.additionalContext` | `output.system[]`                       | `hookSpecificOutput.additionalContext` |
| **Tag style**          | `<prunus>` XML                                             | `[prunus]` bracket                     | `[prunus]` bracket                      | `[prunus]` bracket                     |
| **Hook mechanism**     | Deno script (subprocess)                                   | Deno script (subprocess)               | Bun plugin (in-process)                 | Deno script (subprocess)               |
| **MCP transport**      | `type: "http"`                                             | `httpUrl` (StreamableHTTP)             | `type: "remote"`                        | `httpUrl` (StreamableHTTP)             |
| **Settings file**      | `~/.claude/settings.json` (hooks) + `~/.claude.json` (MCP) | `~/.gemini/settings.json`              | `~/.config/opencode/opencode.json`      | `~/.qwen/settings.json`                |
| **Command file**       | `~/.claude/commands/prunus.md`                             | `~/.gemini/commands/prunus.md`         | `~/.config/opencode/commands/prunus.md` | `~/.qwen/commands/prunus.md`           |
| **Windows**            | ✅ (Bun cross-platform shell)                              | ⚠️ hooks via PowerShell                | ✅ (TypeScript, cross-platform)         | ⚠️ hooks via PowerShell                |

**Tag style:** Gemini CLI and Qwen-Code HTML-escape `<` and `>` in hook output, so `<prunus>` XML tags would render as
`&lt;prunus&gt;`. Both use `[prunus]` bracket format instead. Gemini CLI additionally wraps `additionalContext` in
`<hook_context>` tags. Claude Code does not escape, so it uses `<prunus>` XML tags.

## Install

```sh
# From a running prunus server (recommended)
deno run --allow-all http://prunus-host:9100/cli/install

# Or locally from the repo
deno run --allow-all src/cli/install.ts
```

Flags:

- `-y` / `--yes` — non-interactive, accept all defaults and auto-detect installed tools
- Positional args — specify tools explicitly: `claude-code gemini-cli opencode qwen-code`

The installer prompts for server URL and auth token → writes `~/.prunus/settings.json`, then per tool: installs the
`/prunus` command file, registers the MCP server, installs hooks/plugin.

## `/prunus` Slash Command

Installed as a markdown slash command in each tool's commands directory. Supports:

- `/prunus status` — show effective merged settings for the current directory
- `/prunus init` — create or update `.prunus/settings.json` for the current project
- `/prunus ingest [guidance]` — compose a curated summary document from the current session and send via `contribute`
  MCP tool. `guidance` is optional free text that shapes what the document covers.

The command file is transformed at install time:

- Gemini CLI and Qwen-Code: `$ARGUMENTS` → `{{args}}`, "in Bash" → "in a shell"
- OpenCode: prepends YAML frontmatter (`name`, `description`)

## Hook Input Format

All three Deno hook scripts receive hook data via `stdin` as JSON:

```json
{
  "session_id": "...",
  "transcript_path": "/path/to/session.jsonl",
  "cwd": "/path/to/project",
  "hook_event_name": "UserPromptSubmit",
  "timestamp": "2026-01-01T00:00:00Z",
  "prompt": "the user's prompt text"
}
```

The hook reads `cwd` to resolve project settings and `prompt` as the search query for context injection.

## Context Injection Flow

```
User sends prompt
  └─ Hook/plugin fires with prompt text
       └─ GET /tree/{tree}/context?query=<prompt text>
            └─ Server: hybrid vector+FTS search → top N notes
                 └─ Note summaries injected as additionalContext
                      └─ Session AI calls read_note for full content if needed
```

If the context endpoint returns no results (no relevant notes, tree/enabled not set), the hook exits silently — no
context is injected and the prompt proceeds normally.

## Claude Code

**Hook:** `UserPromptSubmit` — fires before each prompt is sent to the model.

Hook file: `~/.prunus/hooks/claude-code/user-prompt-submit.ts`

Output format (written to stdout):

```json
{
  "additionalContext": "<prunus tree=\"..\" project=\"..\">\nRelevant tree notes — use read_note MCP tool to retrieve full content:\n- path/to/note.md: summary\n</prunus>"
}
```

Hook registration in `~/.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "matcher": "",
      "hooks": [
        {
          "type": "command",
          "command": "deno run --allow-all --no-check \"~/.prunus/hooks/claude-code/user-prompt-submit.ts\""
        }
      ]
    }]
  }
}
```

MCP registration in `~/.claude.json`:

```json
{
  "mcpServers": {
    "prunus": { "type": "http", "url": "http://prunus-host:9100/mcp", "headers": { "Authorization": "Bearer <token>" } }
  }
}
```

## Gemini CLI

**Hook:** `BeforeAgent` — fires before each agent invocation (per user prompt).

Hook file: `~/.prunus/hooks/gemini-cli/before-agent.ts`

Output format:

```json
{
  "hookSpecificOutput": {
    "additionalContext": "[prunus tree=\"..\" project=\"..\"]\nRelevant tree notes — use read_note MCP tool to retrieve full content:\n- path/to/note.md: summary\n[/prunus]"
  }
}
```

Hook + MCP registration in `~/.gemini/settings.json`:

```json
{
  "hooks": {
    "BeforeAgent": [{
      "hooks": [
        {
          "type": "command",
          "name": "prunus-before-agent",
          "command": "deno run --allow-all --no-check \"~/.prunus/hooks/gemini-cli/before-agent.ts\""
        }
      ]
    }]
  },
  "mcpServers": {
    "prunus": { "httpUrl": "http://prunus-host:9100/mcp", "headers": { "Authorization": "Bearer <token>" } }
  }
}
```

## OpenCode

OpenCode uses an in-process Bun plugin rather than external hook scripts. The plugin is auto-discovered from
`~/.config/opencode/plugins/prunus.ts`.

**How it works:**

1. `chat.message` fires when the user sends a message — provides the full message parts including prompt text
2. Plugin fetches relevant notes using the prompt text as a query, caches them
3. `experimental.chat.system.transform` fires before the LLM call — injects cached notes into system prompt

This is equivalent to the per-prompt hook approach in the other three tools. The `chat.message` + `system.transform`
split is required because OpenCode has no single hook that both has the prompt text and can inject into system context.

Plugin file: `~/.config/opencode/plugins/prunus.ts`

The plugin reads settings from `~/.prunus/settings.json` and `.prunus/settings.json` walk-up using Bun APIs (`Bun.file`,
`process.env`) instead of Deno.

MCP registration in `~/.config/opencode/opencode.json`:

```json
{
  "mcp": {
    "prunus": {
      "type": "remote",
      "url": "http://prunus-host:9100/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

## Qwen-Code

Qwen-Code is a fork of Gemini CLI. Integration is identical to Gemini CLI except for the settings file location and hook
event name (`UserPromptSubmit` not `BeforeAgent`).

Hook file: `~/.prunus/hooks/qwen-code/user-prompt-submit.ts`

Output format: same as Gemini CLI (`hookSpecificOutput.additionalContext`, bracket tag style).

Hook + MCP registration in `~/.qwen/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "hooks": [
        {
          "type": "command",
          "name": "prunus-user-prompt-submit",
          "command": "deno run --allow-all --no-check \"~/.prunus/hooks/qwen-code/user-prompt-submit.ts\""
        }
      ]
    }]
  },
  "mcpServers": {
    "prunus": { "httpUrl": "http://prunus-host:9100/mcp", "headers": { "Authorization": "Bearer <token>" } }
  }
}
```

## Shared Hook Library

Claude Code, Gemini CLI, and Qwen-Code share a common Deno library installed at:

- `~/.prunus/hooks/mod.ts` — settings loading, context fetch, `runContextHook` entry point
- `~/.prunus/hooks/deno.json` — Deno import map (`@std/path`)

Each tool's hook script is a one-liner:

```ts
// claude-code/user-prompt-submit.ts
import { runContextHook } from '../mod.ts'
await runContextHook('xml', (ctx) => ({ additionalContext: ctx }))

// gemini-cli/before-agent.ts and qwen-code/user-prompt-submit.ts
import { runContextHook } from '../mod.ts'
await runContextHook('bracket', (ctx) => ({ hookSpecificOutput: { additionalContext: ctx } }))
```

`runContextHook` reads stdin, loads merged settings, calls `/context?query=<prompt>`, writes the JSON envelope to
stdout. Exits silently with no output if prunus is disabled, tree is unset, or no relevant notes are found.

## Full Hook Event Reference

All events confirmed from source code. OpenCode uses in-process plugins, not shell hooks.

| Concept            | Claude Code          | Gemini CLI                            | Qwen-Code           | OpenCode                               |
| ------------------ | -------------------- | ------------------------------------- | ------------------- | -------------------------------------- |
| **User prompt**    | `UserPromptSubmit`   | `BeforeAgent`                         | `UserPromptSubmit`  | `chat.message`                         |
| **Turn end**       | `Stop`               | `AfterAgent`                          | `Stop`              | `stop`                                 |
| **Before compact** | `PreCompact`         | `PreCompress`                         | `PreCompact`        | `experimental.session.compacting`      |
| **After compact**  | `PostCompact`        | —                                     | —                   | `session.compacted`                    |
| **Session start**  | `SessionStart`       | `SessionStart`                        | `SessionStart`      | `session.created`                      |
| **Session end**    | `SessionEnd`         | `SessionEnd`                          | `SessionEnd`        | `session.deleted` / `session.idle`     |
| **Before tool**    | `PreToolUse`         | `BeforeTool`                          | `PreToolUse`        | `tool.execute.before`                  |
| **After tool**     | `PostToolUse`        | `AfterTool`                           | `PostToolUse`       | `tool.execute.after`                   |
| **Permission**     | `PermissionRequest`  | —                                     | `PermissionRequest` | `permission.asked`                     |
| **LLM request**    | —                    | `BeforeModel` / `BeforeToolSelection` | —                   | `experimental.chat.messages.transform` |
| **System prompt**  | —                    | —                                     | —                   | `experimental.chat.system.transform`   |
| **Config**         | JSON `hooks` key     | JSON `hooks` key                      | JSON `hooks` key    | JS/TS plugin module                    |
| **Handler type**   | shell / HTTP / agent | shell                                 | shell               | in-process JS function                 |

## Architecture & Security

### Subprocess hooks vs TypeScript plugins

Claude Code established the subprocess hook convention. Gemini CLI independently adopted a compatible design (Apache 2.0
/ Node.js — not a fork of CC). Qwen-Code forked Gemini CLI. OpenCode rejected the subprocess model as "awkward" (issue
#573) and built an in-process TypeScript plugin system.

Prunus uses **Deno TypeScript** for CC/Gemini CLI/Qwen-Code hooks — cross-platform without requiring bash, Python, or
any runtime beyond Deno. Hook commands are registered as `deno run ... hook.ts`, which PowerShell can execute directly
(no bash syntax).

**Subprocess hooks:**

- Pros: process isolation, easy to audit, Gemini CLI adds env sanitization + per-project trust model
- Cons: hooks run with full OS user permissions; no sandboxing; CC and Qwen-Code have no trust model

**OpenCode plugins:**

- Pros: no shell execution by default, statically analysable TypeScript
- Cons: in-process — a buggy plugin can access all in-memory state, env vars, the SDK client, and every session's
  messages; auto-discovery means any file dropped in `~/.config/opencode/plugins/` executes on next startup

Net: subprocess hooks are safer in the sense that they are isolated processes with a narrow JSON channel. OpenCode
plugins are more powerful precisely because they are not isolated.

### Windows

Gemini CLI and Qwen-Code route hook commands through `powershell.exe` on Windows (confirmed in
`getShellConfiguration()`). Bash scripts fail there. Prunus avoids this by registering `deno run ... hook.ts` — just
calling a binary with arguments, no bash syntax. All hook files use `jsr:@std/path` and
`Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE")` for full portability.
