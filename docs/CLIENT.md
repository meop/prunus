# Client Plugin Comparison

## Feature Matrix

| Feature                       | Claude Code                  | Gemini CLI                  | Qwen-Code                   | OpenCode                                                                         |
| ----------------------------- | ---------------------------- | --------------------------- | --------------------------- | -------------------------------------------------------------------------------- |
| **First-turn context inject** | ✅ `UserPromptSubmit`        | ✅ `BeforeAgent`            | ✅ `UserPromptSubmit`       | ✅² `experimental.chat.system.transform`                                         |
| **Session-end ingest**        | ✅ `Stop`¹                   | ✅ `SessionEnd`             | ✅ `SessionEnd`             | ✅ `event: session.idle`¹                                                        |
| **Pre-compact ingest**        | ✅ `PreCompact`              | ✅ `PreCompress`            | ✅ `PreCompact`             | ✅³ `experimental.session.compacting` (context inject) + `session.idle` (ingest) |
| **MCP server**                | ✅ `type:"http"`             | ✅ `httpUrl`                | ✅ `httpUrl`                | ✅ `type:"remote"`                                                               |
| **Install target**            | `~/.claude/settings.json`    | `~/.gemini/settings.json`   | `~/.qwen/settings.json`     | `~/.config/opencode/opencode.json`                                               |
| **Plugin type**               | Deno TS hooks                | Deno TS hooks               | Deno TS hooks               | TypeScript plugin                                                                |
| **Windows**                   | ✅⁴ Bun cross-platform shell | ⚠️ hooks run via PowerShell | ⚠️ hooks run via PowerShell | ✅ TypeScript, cross-platform                                                    |
| **Hook isolation**            | subprocess                   | subprocess                  | subprocess                  | in-process                                                                       |
| **Env sanitization**          | —                            | ✅ `sanitizeEnvironment()`  | —                           | n/a                                                                              |
| **Project hook trust**        | —                            | ✅ `trusted_hooks.json`     | —                           | n/a                                                                              |

¹ Both Claude Code's `Stop` and OpenCode's `session.idle` fire after every response turn (no `SessionEnd`-equivalent
exposed). The per-session marker file (`~/.prunus/markers/{session_id}.last-ingested`) prevents reprocessing — each
invocation only sends turns since the last successful ingest. OpenCode's plugin uses `client.session.messages()` via the
internal SDK rather than parsing a transcript file.

² OpenCode has no `UserPromptSubmit` / `BeforeAgent` equivalent. Instead, `experimental.chat.system.transform` is used —
it fires on every LLM call and appends the profile to the system prompt. The profile is always present in context rather
than first-turn only. Profile is fetched once per plugin instance and cached.

³ OpenCode has no dedicated pre-compact ingest hook (the `experimental.session.compacting` output only accepts context
strings, not messages). Pre-compact ingest is not needed as a separate step because `session.idle` already ingests
incrementally after every turn — by the time compaction fires, all turns are already ingested.

⁴ Claude Code is closed-source so this cannot be verified from its source, but CC uses Bun as its runtime and Bun ships
a built-in cross-platform shell that handles bash-like syntax on Windows without requiring a system bash. Gemini CLI and
Qwen-Code are Node.js-based; their `getShellConfiguration()` explicitly selects `powershell.exe` on Windows — bash
scripts will not work there without modification.

## Architecture & Security

### Why subprocess hooks vs TypeScript plugins?

**Claude Code** established the subprocess hook convention (originally bash). **Gemini CLI** independently adopted a
compatible design (Apache 2.0 / Node.js — it is not a fork of CC, which is proprietary). The `CLAUDE_PROJECT_DIR` env
var is set in Gemini CLI hooks explicitly "for compatibility." **Qwen-Code** forked Gemini CLI directly. **OpenCode**
rejected the subprocess hook model as "awkward" (issue #573) and built a TypeScript plugin system from scratch.

The fundamental difference is design goal:

- Subprocess hooks: trigger an external process at a lifecycle event — isolated, composable, language-agnostic
- TypeScript plugins: extend the tool's runtime — richer API, in-process, tightly coupled

Prunus uses **Deno TypeScript** for CC/Gemini CLI/Qwen-Code hooks. This gives cross-platform support (Windows, macOS,
Linux) without requiring bash, Python, or any runtime beyond Deno — which is already required by the prunus server. A
single Deno subprocess per hook invocation replaces the prior approach of spawning Python multiple times per hook call.

### Subprocess hook security

**Pros:**

- Process isolation: a hook crash or infinite loop cannot take down the host
- Easy to audit: each hook is a discrete, readable TypeScript file
- Gemini CLI adds environment sanitization (`sanitizeEnvironment()`) and a per-project trust model
  (`~/.gemini/trusted_hooks.json`) — project-level hooks in untrusted folders are blocked entirely

**Cons:**

- Hooks run with the same OS user permissions as the host; a malicious hook can exfiltrate env vars, read files, make
  network calls
- The hook command string itself is a potential injection vector if the host builds it from untrusted data
- No sandboxing; hooks are not namespaced or resource-limited
- CC and Qwen-Code have no equivalent of Gemini CLI's trust model or env sanitization

### OpenCode plugin security

**Pros:**

- No shell execution by default (uses Bun's typed `$` API or `fetch`, not arbitrary shell)
- Easier to statically analyse (TypeScript, not bash)

**Cons:**

- Runs in-process: a buggy or malicious plugin can access all in-memory state, all env vars, the internal SDK client,
  and every session's messages
- Auto-discovery (`~/.config/opencode/plugins/*.ts`) means any file dropped there executes on next startup — a supply
  chain or local file write attack has immediate effect
- No trust model, no sandboxing, no env sanitization equivalent
- Plugins loaded from npm packages introduce transitive dependency risk

**Net verdict:** Subprocess hooks are safer in the sense that they are isolated processes with a narrow JSON
stdin/stdout channel. OpenCode plugins are more powerful precisely because they are not isolated — that cuts both ways.

### Windows

Gemini CLI and Qwen-Code route hook commands through PowerShell on Windows (source-confirmed in
`getShellConfiguration()`). Bash scripts would fail there. Prunus avoids this by registering hook commands as
`deno run ... hook.ts` — PowerShell can execute this directly since it is just calling a binary with arguments, not
interpreting bash syntax. Claude Code likely works via Bun's built-in cross-platform shell. OpenCode is inherently
cross-platform.

All prunus hooks use `jsr:@std/path` for path handling and `Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE")` for the
home directory, so they are fully portable.

## Hook Input/Output Formats

### Context Injection

All hooks receive the same base input via stdin:

```json
{
  "session_id": "...",
  "transcript_path": "/path/to/session.jsonl",
  "cwd": "/path/to/project",
  "hook_event_name": "UserPromptSubmit",
  "timestamp": "2026-01-01T00:00:00Z"
}
```

Output format differs by tool:

**Claude Code** (`UserPromptSubmit`):

```json
{ "additionalContext": "..." }
```

**Gemini CLI** (`BeforeAgent`) and **Qwen-Code** (`UserPromptSubmit`):

```json
{ "hookSpecificOutput": { "additionalContext": "..." } }
```

> **Note**: Both Gemini CLI and Qwen-Code HTML-escape `<` and `>` in `additionalContext` before injecting into the LLM
> request. Prunus uses `[prunus]` bracket format (not `<prunus>` XML tags) to avoid mangling. Gemini CLI additionally
> wraps the content in `<hook_context>...</hook_context>`.

**OpenCode** (`experimental.session.compacting` plugin hook):

```ts
output.context.push('plain text or markdown')
```

### Hook Registration

**Claude Code** (`~/.claude/settings.json`):

```json
{
  "hooks": {
    "UserPromptSubmit": [{ "matcher": "", "hooks": [{ "type": "command", "command": "/path/to/script" }] }],
    "Stop": [...],
    "PreCompact": [...]
  }
}
```

**Gemini CLI** (`~/.gemini/settings.json`):

```json
{
  "hooks": {
    "BeforeAgent": [{ "hooks": [{ "type": "command", "command": "/path/to/script", "name": "prunus-before-agent" }] }],
    "SessionEnd": [...],
    "PreCompress": [...]
  }
}
```

**Qwen-Code** (`~/.qwen/settings.json`) — same structure as Gemini CLI, no `matcher` field:

```json
{
  "hooks": {
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "/path/to/script", "name": "prunus-user-prompt-submit" }] }],
    "SessionEnd": [...],
    "PreCompact": [...]
  }
}
```

**OpenCode** — plugin auto-discovered from `~/.config/opencode/plugins/*.ts`; MCP in `~/.config/opencode/opencode.json`:

```json
{
  "mcp": {wr
    "prunus": { "type": "remote", "url": "http://localhost:9100/mcp", "headers": { "Authorization": "Bearer ..." } }
  }
}
```

## Install Scripts

All installers are Deno TypeScript (cross-platform: Windows, macOS, Linux):

```
client/
  claude-code/install.ts   deno run --allow-all client/claude-code/install.ts
  gemini-cli/install.ts    deno run --allow-all client/gemini-cli/install.ts
  qwen-code/install.ts     deno run --allow-all client/qwen-code/install.ts
  opencode/install.ts      deno run --allow-all client/opencode/install.ts
```

For Claude Code, Gemini CLI, and Qwen-Code: prompts for `PRUNUS_URL` and `PRUNUS_AUTH_TOKEN`, writes `~/.prunus/.env`,
copies hooks and the shared module to `~/.prunus/hooks/`, runs `deno cache` to pre-fetch JSR imports, and registers
hooks + MCP in the tool's settings file. Hook commands registered in settings are
`deno run --allow-all --no-check <hook.ts>`.

For OpenCode: copies `plugin.ts` to `~/.config/opencode/plugins/prunus.ts` (auto-discovered by OpenCode on startup) and
registers the MCP server in `~/.config/opencode/opencode.json` under the `mcp` key. Does not write `~/.prunus/.env`
(OpenCode plugins read directly from `process.env`).

## Shared Config

Hook config lives in `~/.prunus/.env` (written by the installer, loaded by `loadEnv()` in `shared/mod.ts`):

```
PRUNUS_URL=http://localhost:9100
PRUNUS_AUTH_TOKEN=
```

Per-project vault selection: add `PRUNUS_VAULT=myvault` to the project's `.env` file. Hooks are a no-op if
`PRUNUS_VAULT` is unset.

Marker files for pre-compact/session-end delta tracking: `~/.prunus/markers/{session_id}.last-ingested`
