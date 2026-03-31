#!/usr/bin/env -S deno run --allow-all
/**
 * Prunus installer — Claude Code
 * Copies hooks and /prunus command to ~/.prunus/ and ~/.claude/,
 * writes ~/.prunus/settings.json, and registers hooks + MCP in ~/.claude/settings.json.
 *
 * Run locally:  deno run --allow-all install.ts
 * Run remotely: deno run --allow-all http://prunus-host:9100/install/claude-code
 */

import {
  cacheHooks,
  copyOrFetch,
  HOME,
  installCommand,
  installSharedFiles,
  join,
  promptConfig,
  readJsonFile,
  writeJsonFile,
  writeUserSettings,
} from '../installer.ts'

const SCRIPT_URL = new URL('.', import.meta.url).href // .../client/claude-code/
const CLIENT_URL = new URL('..', import.meta.url).href // .../client/

const PRUNUS_DIR = join(HOME, '.prunus')
const HOOKS_DIR = join(PRUNUS_DIR, 'hooks', 'claude-code')
const CLAUDE_DIR = join(HOME, '.claude')
const CLAUDE_SETTINGS = join(CLAUDE_DIR, 'settings.json')

console.log('=== prunus install claude-code ===')
console.log('')

const { prunusUrl, authToken } = await promptConfig(PRUNUS_DIR)
console.log('')

await installSharedFiles(PRUNUS_DIR, CLIENT_URL)

await Deno.mkdir(HOOKS_DIR, { recursive: true })
for (const hook of ['user-prompt-submit.ts', 'stop.ts', 'pre-compact.ts']) {
  await copyOrFetch(new URL(`hooks/${hook}`, SCRIPT_URL).href, join(HOOKS_DIR, hook))
}

await writeUserSettings(PRUNUS_DIR, prunusUrl, authToken)
await installCommand(new URL('prunus.md', CLIENT_URL).href, join(CLAUDE_DIR, 'commands'))
await cacheHooks([
  join(HOOKS_DIR, 'user-prompt-submit.ts'),
  join(HOOKS_DIR, 'stop.ts'),
  join(HOOKS_DIR, 'pre-compact.ts'),
])

const settings = await readJsonFile(CLAUDE_SETTINGS)
const hooks = (settings.hooks ?? {}) as Record<string, unknown>

function makeHook(script: string) {
  return [{
    matcher: '',
    hooks: [{
      type: 'command',
      command: `deno run --allow-all --no-check "${script}"`,
    }],
  }]
}

hooks['UserPromptSubmit'] = makeHook(join(HOOKS_DIR, 'user-prompt-submit.ts'))
hooks['Stop'] = makeHook(join(HOOKS_DIR, 'stop.ts'))
hooks['PreCompact'] = makeHook(join(HOOKS_DIR, 'pre-compact.ts'))
settings.hooks = hooks

const mcpServers = (settings.mcpServers ?? {}) as Record<string, unknown>
const mcpEntry: Record<string, unknown> = { type: 'http', url: `${prunusUrl}/mcp` }
if (authToken) mcpEntry.headers = { Authorization: `Bearer ${authToken}` }
mcpServers.prunus = mcpEntry
settings.mcpServers = mcpServers

await writeJsonFile(CLAUDE_SETTINGS, settings)

console.log('')
console.log('restart claude-code for hooks and mcp to take effect')
console.log('run /prunus to init a new project')
