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
  console.log(`wrote ${dest}`)
}

async function installSharedFiles(): Promise<void> {
  const hooksDir = join(PRUNUS_DIR, 'hooks')
  await Deno.mkdir(hooksDir, { recursive: true })
  await copyOrFetch(new URL('hooks/mod.ts', BASE_URL).href, join(hooksDir, 'mod.ts'))
  await copyOrFetch(new URL('hooks/deno.json', BASE_URL).href, join(hooksDir, 'deno.json'))
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

// tool name → binary name in PATH
const TOOLS: Record<string, string> = {
  'claude-code': 'claude',
  'gemini-cli': 'gemini',
  'opencode': 'opencode',
  'qwen-code': 'qwen',
}
type Tool = keyof typeof TOOLS

function parseTools(input: string): Tool[] {
  const names = input.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (names.length === 0) {
    console.error('no tools specified')
    Deno.exit(1)
  }
  const invalid = names.filter((n) => !(n in TOOLS))
  if (invalid.length) {
    console.error(`unknown tool(s): ${invalid.join(', ')}`)
    Deno.exit(1)
  }
  return names
}

async function inPath(bin: string): Promise<boolean> {
  try {
    const cmd = isWindows ? 'where' : 'which'
    const { code } = await new Deno.Command(cmd, { args: [bin], stdout: 'null', stderr: 'null' }).output()
    return code === 0
  } catch {
    return false
  }
}

async function defaultTools(): Promise<Tool[]> {
  const found: Tool[] = []
  for (const tool of Object.keys(TOOLS)) {
    if (await inPath(TOOLS[tool])) found.push(tool)
  }
  return found
}

let tools: Tool[]
if (Deno.args.length > 0) {
  tools = parseTools(Deno.args.join(' '))
} else {
  const detected = await defaultTools()
  const detectedStr = detected.length ? detected.join(' ') : ''
  const input = ask(`? tools [${Object.keys(TOOLS).join(' | ')}]${detectedStr ? ` (${detectedStr}):` : ':'}`).trim()
  tools = input ? parseTools(input) : detected
  if (tools.length === 0) {
    console.error('no installed tools detected and none specified')
    Deno.exit(1)
  }
}

const { prunusUrl, authToken } = await promptConfig()
await writeUserSettings(prunusUrl, authToken)
console.log('')

for (let i = 0; i < tools.length; i++) {
  const tool = tools[i]
  if (i > 0) console.log('')
  console.log(`=== prunus install ${tool} ===`)

// ── claude-code ───────────────────────────────────────────────────────────────

if (tool === 'claude-code') {
  const CLAUDE_DIR = join(HOME, '.claude')
  const HOOKS_DIR = join(PRUNUS_DIR, 'hooks', 'claude-code')
  const CLAUDE_SETTINGS = join(CLAUDE_DIR, 'settings.json')

  await installCommand(new URL('prunus.md', BASE_URL).href, join(CLAUDE_DIR, 'commands'))

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

  await installSharedFiles()
  await Deno.mkdir(HOOKS_DIR, { recursive: true })
  for (const hook of ['user-prompt-submit.ts', 'stop.ts', 'pre-compact.ts']) {
    await copyOrFetch(new URL(`hooks/claude-code/${hook}`, BASE_URL).href, join(HOOKS_DIR, hook))
  }
  await cacheHooks([
    join(HOOKS_DIR, 'user-prompt-submit.ts'),
    join(HOOKS_DIR, 'stop.ts'),
    join(HOOKS_DIR, 'pre-compact.ts'),
  ])

  console.log('restart claude-code for hooks and mcp to take effect')
}

// ── gemini-cli ────────────────────────────────────────────────────────────────

if (tool === 'gemini-cli') {
  const GEMINI_DIR = join(HOME, '.gemini')
  const HOOKS_DIR = join(PRUNUS_DIR, 'hooks', 'gemini-cli')
  const GEMINI_SETTINGS = join(GEMINI_DIR, 'settings.json')

  await installCommand(
    new URL('prunus.md', BASE_URL).href,
    join(GEMINI_DIR, 'commands'),
    (s) => s.replaceAll('$ARGUMENTS', '{{args}}').replaceAll('in Bash', 'in a shell').replaceAll('Use Bash only', 'Use shell only'),
  )

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

  await installSharedFiles()
  await Deno.mkdir(HOOKS_DIR, { recursive: true })
  for (const hook of ['before-agent.ts', 'session-end.ts', 'pre-compress.ts']) {
    await copyOrFetch(new URL(`hooks/gemini-cli/${hook}`, BASE_URL).href, join(HOOKS_DIR, hook))
  }
  await cacheHooks([
    join(HOOKS_DIR, 'before-agent.ts'),
    join(HOOKS_DIR, 'session-end.ts'),
    join(HOOKS_DIR, 'pre-compress.ts'),
  ])

  console.log('restart gemini-cli for hooks and mcp to take effect')
}

// ── qwen-code ─────────────────────────────────────────────────────────────────

if (tool === 'qwen-code') {
  const QWEN_DIR = join(HOME, '.qwen')
  const HOOKS_DIR = join(PRUNUS_DIR, 'hooks', 'qwen-code')
  const QWEN_SETTINGS = join(QWEN_DIR, 'settings.json')

  await installCommand(
    new URL('prunus.md', BASE_URL).href,
    join(QWEN_DIR, 'commands'),
    (s) => s.replaceAll('$ARGUMENTS', '{{args}}').replaceAll('in Bash', 'in a shell').replaceAll('Use Bash only', 'Use shell only'),
  )

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

  await installSharedFiles()
  await Deno.mkdir(HOOKS_DIR, { recursive: true })
  for (const hook of ['user-prompt-submit.ts', 'session-end.ts', 'pre-compact.ts']) {
    await copyOrFetch(new URL(`hooks/qwen-code/${hook}`, BASE_URL).href, join(HOOKS_DIR, hook))
  }
  await cacheHooks([
    join(HOOKS_DIR, 'user-prompt-submit.ts'),
    join(HOOKS_DIR, 'session-end.ts'),
    join(HOOKS_DIR, 'pre-compact.ts'),
  ])

  console.log('restart qwen-code for hooks and mcp to take effect')
}

// ── opencode ──────────────────────────────────────────────────────────────────

if (tool === 'opencode') {
  const OPENCODE_CONFIG = join(HOME, '.config', 'opencode')
  const PLUGIN_DIR = join(OPENCODE_CONFIG, 'plugins')
  const OPENCODE_JSON = join(OPENCODE_CONFIG, 'opencode.json')

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

  await Deno.mkdir(PLUGIN_DIR, { recursive: true })
  await copyOrFetch(new URL('plugins/opencode/prunus.ts', BASE_URL).href, join(PLUGIN_DIR, 'prunus.ts'))

  console.log('restart opencode for plugin and mcp to take effect')
}

} // end for (const tool of tools)

console.log('')
console.log('run \`/prunus init\` to init a new project')
