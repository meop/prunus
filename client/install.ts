#!/usr/bin/env -S deno run --allow-all
/**
 * Prunus installer — unified
 * Run locally:  deno run --allow-all install.ts [tool]
 * Run remotely: deno run --allow-all http://prunus-host:9100/install
 *
 * tool: claude-code | gemini-cli | qwen-code | opencode
 */

// ── path helpers ──────────────────────────────────────────────────────────────

const isWindows = Deno.build.os === 'windows'
const sep = isWindows ? '\\' : '/'

function join(...parts: string[]): string {
  return parts.join(sep).replace(isWindows ? /[/\\]+/g : /\/+/g, sep)
}

function dirname(p: string): string {
  if (isWindows) {
    const norm = p.replaceAll('/', '\\')
    const i = norm.lastIndexOf('\\')
    if (i < 0) return '.'
    if (i === 2 && norm[1] === ':') return norm.slice(0, 3) // drive root: C:\
    return norm.slice(0, i)
  }
  const i = p.lastIndexOf('/')
  return i <= 0 ? '/' : p.slice(0, i)
}

function fromFileUrl(url: string | URL): string {
  const pathname = decodeURIComponent((url instanceof URL ? url : new URL(url)).pathname)
  if (isWindows) return pathname.slice(1).replaceAll('/', '\\') // /C:/foo → C:\foo
  return pathname
}

// ── constants ─────────────────────────────────────────────────────────────────

const HOME = Deno.env.get('HOME') ?? Deno.env.get('USERPROFILE') ?? '.'
const BASE_URL = new URL('.', import.meta.url).href // .../client/
const PRUNUS_DIR = join(HOME, '.prunus')

// ── prompts ───────────────────────────────────────────────────────────────────

function ask(message: string): string {
  const answer = prompt(message)
  if (answer === null) Deno.exit(0) // Ctrl-C
  return answer
}

function promptUpdate(path: string): boolean {
  return ask(`? update ${path} [y, [n]]:`).trim().toLowerCase() !== 'n'
}

async function promptConfig(): Promise<{ prunusUrl: string; authToken: string }> {
  const existing = await readJsonFile(join(PRUNUS_DIR, 'settings.json'))
  const hasUrl = !!existing.serverUrl
  const defaultUrl = String(existing.serverUrl ?? 'http://localhost:9100')
  const defaultToken = String(existing.authToken ?? '')
  const prunusUrl = ask(`? ${hasUrl ? 'update' : 'set'} prunus server url [${defaultUrl}]:`) || defaultUrl
  const hasToken = !!existing.authToken
  const tokenSuffix = hasToken ? `[${defaultToken}]:` : '(leave empty if none):'
  const authToken = ask(`? ${hasToken ? 'update' : 'set'} auth token ${tokenSuffix}`) || defaultToken
  return { prunusUrl, authToken }
}

// ── file helpers ──────────────────────────────────────────────────────────────

async function fetchContent(src: string): Promise<string> {
  if (src.startsWith('file://')) return await Deno.readTextFile(fromFileUrl(src))
  const resp = await fetch(src)
  if (!resp.ok) throw new Error(`failed to fetch ${src}: ${resp.status} ${resp.statusText}`)
  return await resp.text()
}

async function writeFile(dest: string, getContent: () => Promise<string>): Promise<void> {
  let isNew = true
  try {
    await Deno.stat(dest)
    isNew = false
  } catch { /* not found */ }
  if (!isNew && !promptUpdate(dest)) return
  await Deno.writeTextFile(dest, await getContent())
  if (isNew) console.log(`wrote ${dest}`)
}

async function copyOrFetch(src: string, dest: string): Promise<void> {
  await Deno.writeTextFile(dest, await fetchContent(src))
}

async function installSharedFiles(): Promise<void> {
  const sharedDir = join(PRUNUS_DIR, 'hooks', 'shared')
  await Deno.mkdir(sharedDir, { recursive: true })
  await copyOrFetch(new URL('mod.ts', BASE_URL).href, join(sharedDir, 'mod.ts'))
  await copyOrFetch(new URL('hooks-deno.json', BASE_URL).href, join(PRUNUS_DIR, 'hooks', 'deno.json'))
}

async function installCommand(
  srcUrl: string,
  destDir: string,
  transform?: (content: string) => string,
  filename?: string,
): Promise<void> {
  await Deno.mkdir(destDir, { recursive: true })
  const name = filename ?? new URL(srcUrl).pathname.split('/').pop()!
  await writeFile(join(destDir, name), async () => {
    const content = await fetchContent(srcUrl)
    return transform ? transform(content) : content
  })
}

async function cacheHooks(hookFiles: string[]): Promise<void> {
  const { code } = await new Deno.Command('deno', {
    args: ['cache', '--no-check', ...hookFiles],
    stdout: 'inherit',
    stderr: 'inherit',
  }).output()
  if (code !== 0) console.error('warning: deno cache failed — hooks will fetch imports on first run')
}

async function readJsonFile(path: string): Promise<Record<string, unknown>> {
  try {
    const content = (await Deno.readTextFile(path)).trim()
    if (content) return JSON.parse(content) as Record<string, unknown>
  } catch { /* absent or invalid */ }
  return {}
}

async function writeJsonFile(path: string, data: Record<string, unknown>): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true })
  await writeFile(path, () => Promise.resolve(JSON.stringify(data, null, 2) + '\n'))
}

async function writeUserSettings(serverUrl: string, authToken: string): Promise<void> {
  const settings: Record<string, unknown> = { serverUrl }
  if (authToken) settings.authToken = authToken
  await writeJsonFile(join(PRUNUS_DIR, 'settings.json'), settings)
}

// ── tool selection ────────────────────────────────────────────────────────────

const TOOLS = ['claude-code', 'gemini-cli', 'qwen-code', 'opencode'] as const
type Tool = typeof TOOLS[number]

function isTool(s: string): s is Tool {
  return (TOOLS as readonly string[]).includes(s)
}

let tool = Deno.args[0]?.trim().toLowerCase() ?? ''
if (!isTool(tool)) {
  tool = ask(`? tool [${TOOLS.join(' | ')}]:`).trim().toLowerCase()
  if (!isTool(tool)) {
    console.error(`unknown tool: ${tool}`)
    Deno.exit(1)
  }
}

console.log(`\n=== prunus install ${tool} ===\n`)

const { prunusUrl, authToken } = await promptConfig()
console.log('')

// ── claude-code ───────────────────────────────────────────────────────────────

if (tool === 'claude-code') {
  const CLAUDE_DIR = join(HOME, '.claude')
  const HOOKS_DIR = join(PRUNUS_DIR, 'hooks', 'claude-code')
  const CLAUDE_SETTINGS = join(CLAUDE_DIR, 'settings.json')

  await installSharedFiles()
  await Deno.mkdir(HOOKS_DIR, { recursive: true })
  for (const hook of ['user-prompt-submit.ts', 'stop.ts', 'pre-compact.ts']) {
    await copyOrFetch(new URL(`claude-code/hooks/${hook}`, BASE_URL).href, join(HOOKS_DIR, hook))
  }

  await writeUserSettings(prunusUrl, authToken)
  await installCommand(new URL('prunus.md', BASE_URL).href, join(CLAUDE_DIR, 'commands'))
  await cacheHooks([
    join(HOOKS_DIR, 'user-prompt-submit.ts'),
    join(HOOKS_DIR, 'stop.ts'),
    join(HOOKS_DIR, 'pre-compact.ts'),
  ])

  const settings = await readJsonFile(CLAUDE_SETTINGS)
  const hooks = (settings.hooks ?? {}) as Record<string, unknown>
  const makeHook = (script: string) => [{
    matcher: '',
    hooks: [{ type: 'command', command: `deno run --allow-all --no-check "${script}"` }],
  }]
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
}

// ── gemini-cli ────────────────────────────────────────────────────────────────

if (tool === 'gemini-cli') {
  const GEMINI_DIR = join(HOME, '.gemini')
  const HOOKS_DIR = join(PRUNUS_DIR, 'hooks', 'gemini-cli')
  const GEMINI_SETTINGS = join(GEMINI_DIR, 'settings.json')

  await installSharedFiles()
  await Deno.mkdir(HOOKS_DIR, { recursive: true })
  for (const hook of ['before-agent.ts', 'session-end.ts', 'pre-compress.ts']) {
    await copyOrFetch(new URL(`gemini-cli/hooks/${hook}`, BASE_URL).href, join(HOOKS_DIR, hook))
  }

  await writeUserSettings(prunusUrl, authToken)
  await installCommand(
    new URL('prunus.md', BASE_URL).href,
    join(GEMINI_DIR, 'commands'),
    (s) => s.replaceAll('$ARGUMENTS', '{{args}}').replaceAll('in Bash', 'in a shell').replaceAll('Use Bash only', 'Use shell only'),
  )
  await cacheHooks([
    join(HOOKS_DIR, 'before-agent.ts'),
    join(HOOKS_DIR, 'session-end.ts'),
    join(HOOKS_DIR, 'pre-compress.ts'),
  ])

  const settings = await readJsonFile(GEMINI_SETTINGS)
  const hooks = (settings.hooks ?? {}) as Record<string, unknown>
  // Gemini CLI hook format: no matcher field
  const makeHook = (name: string, script: string) => [{
    hooks: [{ type: 'command', command: `deno run --allow-all --no-check "${script}"`, name: `prunus-${name}` }],
  }]
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
}

// ── qwen-code ─────────────────────────────────────────────────────────────────

if (tool === 'qwen-code') {
  const QWEN_DIR = join(HOME, '.qwen')
  const HOOKS_DIR = join(PRUNUS_DIR, 'hooks', 'qwen-code')
  const QWEN_SETTINGS = join(QWEN_DIR, 'settings.json')

  await installSharedFiles()
  await Deno.mkdir(HOOKS_DIR, { recursive: true })
  for (const hook of ['user-prompt-submit.ts', 'session-end.ts', 'pre-compact.ts']) {
    await copyOrFetch(new URL(`qwen-code/hooks/${hook}`, BASE_URL).href, join(HOOKS_DIR, hook))
  }

  await writeUserSettings(prunusUrl, authToken)
  await installCommand(
    new URL('prunus.md', BASE_URL).href,
    join(QWEN_DIR, 'commands'),
    (s) => s.replaceAll('$ARGUMENTS', '{{args}}').replaceAll('in Bash', 'in a shell').replaceAll('Use Bash only', 'Use shell only'),
  )
  await cacheHooks([
    join(HOOKS_DIR, 'user-prompt-submit.ts'),
    join(HOOKS_DIR, 'session-end.ts'),
    join(HOOKS_DIR, 'pre-compact.ts'),
  ])

  const settings = await readJsonFile(QWEN_SETTINGS)
  const hooks = (settings.hooks ?? {}) as Record<string, unknown>
  // Qwen-Code hook format: no matcher field (confirmed from integration tests)
  const makeHook = (name: string, script: string) => [{
    hooks: [{ type: 'command', command: `deno run --allow-all --no-check "${script}"`, name: `prunus-${name}` }],
  }]
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
}

// ── opencode ──────────────────────────────────────────────────────────────────

if (tool === 'opencode') {
  const OPENCODE_CONFIG = join(HOME, '.config', 'opencode')
  const PLUGIN_DIR = join(OPENCODE_CONFIG, 'plugins')
  const OPENCODE_JSON = join(OPENCODE_CONFIG, 'opencode.json')

  await Deno.mkdir(PLUGIN_DIR, { recursive: true })
  await copyOrFetch(new URL('opencode/plugins/prunus.ts', BASE_URL).href, join(PLUGIN_DIR, 'prunus.ts'))

  await writeUserSettings(prunusUrl, authToken)
  await installCommand(
    new URL('prunus.md', BASE_URL).href,
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
}
