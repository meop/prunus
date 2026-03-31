#!/usr/bin/env -S deno run --allow-all
/**
 * Prunus installer — OpenCode
 * Copies plugin.ts to ~/.config/opencode/plugins/ (auto-discovered by OpenCode),
 * installs the /prunus command, writes ~/.prunus/settings.json, and registers the MCP server
 * in ~/.config/opencode/opencode.json.
 *
 * Plugin capabilities:
 *   experimental.chat.system.transform — injects vault profile into system prompt (every LLM call)
 *   event: session.idle               — ingest session transcript after each turn
 *   experimental.session.compacting   — injects vault profile into compaction context
 *
 * Run locally:  deno run --allow-all install.ts
 * Run remotely: deno run --allow-all http://prunus-host:9100/install/opencode
 */

import {
  copyOrFetch,
  HOME,
  installCommand,
  join,
  promptConfig,
  readJsonFile,
  writeJsonFile,
  writeUserSettings,
} from '../installer.ts'

const SCRIPT_URL = new URL('.', import.meta.url).href // .../client/opencode/
const CLIENT_URL = new URL('..', import.meta.url).href // .../client/

const PRUNUS_DIR = join(HOME, '.prunus')
const OPENCODE_CONFIG = join(HOME, '.config', 'opencode')
const PLUGIN_DIR = join(OPENCODE_CONFIG, 'plugins')
const OPENCODE_JSON = join(OPENCODE_CONFIG, 'opencode.json')

console.log('=== prunus install opencode ===')
console.log('')

const { prunusUrl, authToken } = await promptConfig(PRUNUS_DIR)
console.log('')

await Deno.mkdir(PLUGIN_DIR, { recursive: true })
await copyOrFetch(new URL('plugin.ts', SCRIPT_URL).href, join(PLUGIN_DIR, 'prunus.ts'))

await writeUserSettings(PRUNUS_DIR, prunusUrl, authToken)
await installCommand(
  new URL('prunus.md', CLIENT_URL).href,
  join(OPENCODE_CONFIG, 'commands'),
  (s) => '---\nname: prunus\ndescription: Manage prunus settings for the current project\n---\n\n' + s,
)

// OpenCode uses "mcp" key (not "mcpServers") with type: "remote" for HTTP servers.
// The plugin is auto-discovered from the plugins/ directory — no explicit registration needed.
const config = await readJsonFile(OPENCODE_JSON)
const mcpEntry: Record<string, unknown> = { type: 'remote', url: `${prunusUrl}/mcp` }
if (authToken) mcpEntry.headers = { Authorization: `Bearer ${authToken}` }
const mcp = (config.mcp ?? {}) as Record<string, unknown>
mcp.prunus = mcpEntry
config.mcp = mcp

await writeJsonFile(OPENCODE_JSON, config)

console.log('')
console.log('restart opencode for plugin and mcp to take effect')
console.log('run /prunus to init a new project')
