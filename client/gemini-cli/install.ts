#!/usr/bin/env -S deno run --allow-all
/**
 * Prunus installer — Gemini CLI
 * Copies hooks and /prunus command to ~/.prunus/ and ~/.gemini/,
 * writes ~/.prunus/settings.json, and registers hooks + MCP in ~/.gemini/settings.json.
 *
 * Run locally:  deno run --allow-all install.ts
 * Run remotely: deno run --allow-all http://prunus-host:9100/install/gemini-cli
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

const SCRIPT_URL = new URL('.', import.meta.url).href // .../client/gemini-cli/
const CLIENT_URL = new URL('..', import.meta.url).href // .../client/

const PRUNUS_DIR = join(HOME, '.prunus')
const HOOKS_DIR = join(PRUNUS_DIR, 'hooks', 'gemini-cli')
const GEMINI_DIR = join(HOME, '.gemini')
const GEMINI_SETTINGS = join(GEMINI_DIR, 'settings.json')

console.log('=== prunus install gemini-cli ===')
console.log('')

const { prunusUrl, authToken } = await promptConfig(PRUNUS_DIR)
console.log('')

await installSharedFiles(PRUNUS_DIR, CLIENT_URL)

await Deno.mkdir(HOOKS_DIR, { recursive: true })
for (const hook of ['before-agent.ts', 'session-end.ts', 'pre-compress.ts']) {
  await copyOrFetch(new URL(`hooks/${hook}`, SCRIPT_URL).href, join(HOOKS_DIR, hook))
}

await writeUserSettings(PRUNUS_DIR, prunusUrl, authToken)
await installCommand(
  new URL('prunus.md', CLIENT_URL).href,
  join(GEMINI_DIR, 'commands'),
  (s) =>
    s.replaceAll('$ARGUMENTS', '{{args}}').replaceAll('in Bash', 'in a shell').replaceAll(
      'Use Bash only',
      'Use shell only',
    ),
)
await cacheHooks([
  join(HOOKS_DIR, 'before-agent.ts'),
  join(HOOKS_DIR, 'session-end.ts'),
  join(HOOKS_DIR, 'pre-compress.ts'),
])

const settings = await readJsonFile(GEMINI_SETTINGS)
const hooks = (settings.hooks ?? {}) as Record<string, unknown>

function makeHook(name: string, script: string) {
  return [{
    hooks: [{
      type: 'command',
      command: `deno run --allow-all --no-check "${script}"`,
      name: `prunus-${name}`,
    }],
  }]
}

hooks['BeforeAgent'] = makeHook('before-agent', join(HOOKS_DIR, 'before-agent.ts'))
hooks['SessionEnd'] = makeHook('session-end', join(HOOKS_DIR, 'session-end.ts'))
hooks['PreCompress'] = makeHook('pre-compress', join(HOOKS_DIR, 'pre-compress.ts'))
settings.hooks = hooks

// Gemini CLI uses httpUrl for StreamableHTTP MCP servers
const mcpServers = (settings.mcpServers ?? {}) as Record<string, unknown>
const mcpEntry: Record<string, unknown> = { httpUrl: `${prunusUrl}/mcp` }
if (authToken) mcpEntry.headers = { Authorization: `Bearer ${authToken}` }
mcpServers.prunus = mcpEntry
settings.mcpServers = mcpServers

await writeJsonFile(GEMINI_SETTINGS, settings)

console.log('')
console.log('restart gemini-cli for hooks and mcp to take effect')
console.log('run /prunus to init a new project')
