#!/usr/bin/env -S deno run --allow-all
/**
 * Prunus installer — Qwen-Code
 * Copies hooks and /prunus command to ~/.prunus/ and ~/.qwen/,
 * writes ~/.prunus/settings.json, and registers hooks + MCP in ~/.qwen/settings.json.
 *
 * Run locally:  deno run --allow-all install.ts
 * Run remotely: deno run --allow-all http://prunus-host:9100/install/qwen-code
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

const SCRIPT_URL = new URL('.', import.meta.url).href // .../client/qwen-code/
const CLIENT_URL = new URL('..', import.meta.url).href // .../client/

const PRUNUS_DIR = join(HOME, '.prunus')
const HOOKS_DIR = join(PRUNUS_DIR, 'hooks', 'qwen-code')
const QWEN_DIR = join(HOME, '.qwen')
const QWEN_SETTINGS = join(QWEN_DIR, 'settings.json')

console.log('=== prunus install qwen-code ===')
console.log('')

const { prunusUrl, authToken } = await promptConfig(PRUNUS_DIR)
console.log('')

await installSharedFiles(PRUNUS_DIR, CLIENT_URL)

await Deno.mkdir(HOOKS_DIR, { recursive: true })
for (const hook of ['user-prompt-submit.ts', 'session-end.ts', 'pre-compact.ts']) {
  await copyOrFetch(new URL(`hooks/${hook}`, SCRIPT_URL).href, join(HOOKS_DIR, hook))
}

await writeUserSettings(PRUNUS_DIR, prunusUrl, authToken)
await installCommand(
  new URL('prunus.md', CLIENT_URL).href,
  join(QWEN_DIR, 'commands'),
  (s) =>
    s.replaceAll('$ARGUMENTS', '{{args}}').replaceAll('in Bash', 'in a shell').replaceAll(
      'Use Bash only',
      'Use shell only',
    ),
)
await cacheHooks([
  join(HOOKS_DIR, 'user-prompt-submit.ts'),
  join(HOOKS_DIR, 'session-end.ts'),
  join(HOOKS_DIR, 'pre-compact.ts'),
])

const settings = await readJsonFile(QWEN_SETTINGS)
const hooks = (settings.hooks ?? {}) as Record<string, unknown>

// Qwen-Code hook format: no matcher field (confirmed from integration tests)
function makeHook(name: string, script: string) {
  return [{
    hooks: [{
      type: 'command',
      command: `deno run --allow-all --no-check "${script}"`,
      name: `prunus-${name}`,
    }],
  }]
}

hooks['UserPromptSubmit'] = makeHook('user-prompt-submit', join(HOOKS_DIR, 'user-prompt-submit.ts'))
hooks['SessionEnd'] = makeHook('session-end', join(HOOKS_DIR, 'session-end.ts'))
hooks['PreCompact'] = makeHook('pre-compact', join(HOOKS_DIR, 'pre-compact.ts'))
settings.hooks = hooks

// Qwen-Code is a Gemini CLI fork; httpUrl selects StreamableHTTP transport
const mcpServers = (settings.mcpServers ?? {}) as Record<string, unknown>
const mcpEntry: Record<string, unknown> = { httpUrl: `${prunusUrl}/mcp` }
if (authToken) mcpEntry.headers = { Authorization: `Bearer ${authToken}` }
mcpServers.prunus = mcpEntry
settings.mcpServers = mcpServers

await writeJsonFile(QWEN_SETTINGS, settings)

console.log('')
console.log('restart qwen-code for hooks and mcp to take effect')
console.log('run /prunus to init a new project')
