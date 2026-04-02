#!/usr/bin/env -S deno run --allow-all
/**
 * Prunus installer — unified
 * Run locally:  deno run --allow-all install.ts [--yes/-y] [tool ...]
 * Run remotely: deno run --allow-all http://prunus-host:9100/cli/install[.ts] --reload [-y/--yes]
 *
 * tool: claude-code | gemini-cli | opencode | qwen-code
 * flags: -y / --yes — non-interactive, accept all defaults
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
const BASE_URL = new URL('.', import.meta.url).href
const PRUNUS_DIR = join(HOME, '.prunus')

// ── flags ──────────────────────────────────────────────────────────────────────

const yes = Deno.args.some((a) => a === '-y' || a === '--yes')
const restArgs = Deno.args.filter((a) => a !== '-y' && a !== '--yes')

// ── prompts ───────────────────────────────────────────────────────────────────

function ask(message: string): string {
  if (yes) return ''
  const answer = prompt(message)
  if (answer === null) Deno.exit(0)
  return answer
}

function promptUpdate(path: string): boolean {
  if (yes) return true
  return ask(`? update ${path} [y, [n]]:`).trim().toLowerCase() !== 'n'
}

async function promptConfig(): Promise<{ url: string; token: string }> {
  const existing = await readJsonFile(join(PRUNUS_DIR, 'settings.json'))
  const hasUrl = !!existing.url
  const defaultUrl = String(existing.url ?? 'http://localhost:9100')
  const defaultToken = String(existing.token ?? '')
  const urlSuffix = hasUrl ? ` (${existing.url}):` : ':'
  const url = ask(`? set url [http://localhost:9100]${urlSuffix}`) ||
    defaultUrl
  const hasToken = !!existing.token
  const tokenSuffix = hasToken ? ' (******):' : ':'
  const token = ask(`? set token [leave empty if none]${tokenSuffix}`) ||
    defaultToken
  return { url, token }
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
  console.log(`${isNew ? 'wrote' : 'updated'} ${dest}`)
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

async function cacheHooks(hookFiles: string[]): Promise<void> {
  const { code } = await new Deno.Command('deno', {
    args: ['cache', '--no-check', ...hookFiles],
    stdout: 'inherit',
    stderr: 'inherit',
  }).output()
  if (code !== 0) console.error('warning: deno cache failed — hooks will fetch imports on first run')
}

function purgeStaleHooks(hooks: Record<string, unknown>, hooksDir: string, keep: string[]): void {
  for (const event of Object.keys(hooks)) {
    if (keep.includes(event)) continue
    const entries = hooks[event] as unknown[]
    const filtered = entries.filter((e) => !JSON.stringify(e).includes(hooksDir))
    if (filtered.length === 0) {
      delete hooks[event]
      console.log(`removed stale hook: ${event}`)
    } else {
      hooks[event] = filtered
    }
  }
}

async function writeUserSettings(url: string, token: string): Promise<void> {
  const settings: Record<string, unknown> = { url }
  if (token) settings.token = token
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

console.log('=== pre-install ===')

let tools: Tool[]
if (restArgs.length > 0) {
  tools = parseTools(restArgs.join(' '))
} else if (yes) {
  tools = await defaultTools()
  if (tools.length === 0) {
    console.error('no installed tools detected — specify tool(s) as arguments')
    Deno.exit(1)
  }
} else {
  const detected = await defaultTools()
  const optionStr = Object.keys(TOOLS).join(' ')
  const detectedStr = detected.length ? ` (${detected.join(' ')})` : ''
  const input = ask(`? set tools [${optionStr}]${detectedStr}:`).trim()
  tools = input ? parseTools(input) : detected
  if (tools.length === 0) {
    console.error('no installed tools detected and none specified')
    Deno.exit(1)
  }
}

const { url, token } = await promptConfig()

await writeUserSettings(url, token)
console.log('')

for (let i = 0; i < tools.length; i++) {
  const tool = tools[i]
  if (i > 0) console.log('')
  console.log(`=== install ${tool} ===`)

  // ── claude-code ───────────────────────────────────────────────────────────────

  if (tool === 'claude-code') {
    const CLAUDE_DIR = join(HOME, '.claude')
    const HOOKS_DIR = join(PRUNUS_DIR, 'hooks', 'claude-code')
    const CLAUDE_SETTINGS = join(CLAUDE_DIR, 'settings.json')

    await installCommand(new URL('prunus.md', BASE_URL).href, join(CLAUDE_DIR, 'commands'))

    const settings = await readJsonFile(CLAUDE_SETTINGS)
    const hooks = (settings.hooks ?? {}) as Record<string, unknown>
    purgeStaleHooks(hooks, HOOKS_DIR, ['UserPromptSubmit'])
    hooks['UserPromptSubmit'] = [{
      matcher: '',
      hooks: [{
        type: 'command',
        command: `deno run --allow-all --no-check "${join(HOOKS_DIR, 'user-prompt-submit.ts')}"`,
      }],
    }]
    settings.hooks = hooks
    await writeJsonFile(CLAUDE_SETTINGS, settings)

    // MCP servers are read from ~/.claude.json, NOT ~/.claude/settings.json
    const CLAUDE_JSON = join(HOME, '.claude.json')
    const claudeJson = await readJsonFile(CLAUDE_JSON)
    const mcpServers = (claudeJson.mcpServers ?? {}) as Record<string, unknown>
    const mcpEntry: Record<string, unknown> = { type: 'http', url: `${url}/mcp` }
    if (token) mcpEntry.headers = { Authorization: `Bearer ${token}` }
    mcpServers.prunus = mcpEntry
    claudeJson.mcpServers = mcpServers
    await writeJsonFile(CLAUDE_JSON, claudeJson)

    await installSharedFiles()
    try {
      await Deno.remove(HOOKS_DIR, { recursive: true })
      console.log(`purged ${HOOKS_DIR}`)
    } catch { /* not found */ }
    await Deno.mkdir(HOOKS_DIR, { recursive: true })
    await copyOrFetch(
      new URL('hooks/claude-code/user-prompt-submit.ts', BASE_URL).href,
      join(HOOKS_DIR, 'user-prompt-submit.ts'),
    )
    await cacheHooks([join(HOOKS_DIR, 'user-prompt-submit.ts')])
  }

  // ── gemini-cli ────────────────────────────────────────────────────────────────

  if (tool === 'gemini-cli') {
    const GEMINI_DIR = join(HOME, '.gemini')
    const HOOKS_DIR = join(PRUNUS_DIR, 'hooks', 'gemini-cli')
    const GEMINI_SETTINGS = join(GEMINI_DIR, 'settings.json')

    // Remove stale prunus.md if present from older installs
    try {
      await Deno.remove(join(GEMINI_DIR, 'commands', 'prunus.md'))
      console.log(`removed stale ${join(GEMINI_DIR, 'commands', 'prunus.md')}`)
    } catch { /* not found */ }

    await installCommand(
      new URL('prunus.md', BASE_URL).href,
      join(GEMINI_DIR, 'commands'),
      (s) => {
        const body = s
          .replaceAll('$ARGUMENTS', '{{args}}')
          .replaceAll('in Bash', 'in a shell')
          .replaceAll('Use Bash only', 'Use shell only')
        return `description = "Manage prunus settings for the current project"\nprompt = """\n${body}\n"""\n`
      },
      'prunus.toml',
    )

    const settings = await readJsonFile(GEMINI_SETTINGS)
    const hooks = (settings.hooks ?? {}) as Record<string, unknown>
    purgeStaleHooks(hooks, HOOKS_DIR, ['BeforeAgent'])
    hooks['BeforeAgent'] = [{
      hooks: [{
        type: 'command',
        command: `deno run --allow-all --no-check "${join(HOOKS_DIR, 'before-agent.ts')}"`,
        name: 'prunus-before-agent',
      }],
    }]
    settings.hooks = hooks

    // Gemini CLI uses httpUrl for StreamableHTTP MCP servers
    const mcpServers = (settings.mcpServers ?? {}) as Record<string, unknown>
    const mcpEntry: Record<string, unknown> = { httpUrl: `${url}/mcp` }
    if (token) mcpEntry.headers = { Authorization: `Bearer ${token}` }
    mcpServers.prunus = mcpEntry
    settings.mcpServers = mcpServers

    await writeJsonFile(GEMINI_SETTINGS, settings)

    await installSharedFiles()
    try {
      await Deno.remove(HOOKS_DIR, { recursive: true })
      console.log(`purged ${HOOKS_DIR}`)
    } catch { /* not found */ }
    await Deno.mkdir(HOOKS_DIR, { recursive: true })
    await copyOrFetch(new URL('hooks/gemini-cli/before-agent.ts', BASE_URL).href, join(HOOKS_DIR, 'before-agent.ts'))
    await cacheHooks([join(HOOKS_DIR, 'before-agent.ts')])
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
    const mcpEntry: Record<string, unknown> = { type: 'remote', url: `${url}/mcp` }
    if (token) mcpEntry.headers = { Authorization: `Bearer ${token}` }
    const mcp = (config.mcp ?? {}) as Record<string, unknown>
    mcp.prunus = mcpEntry
    config.mcp = mcp

    await writeJsonFile(OPENCODE_JSON, config)

    await Deno.mkdir(PLUGIN_DIR, { recursive: true })
    await copyOrFetch(new URL('plugins/opencode/prunus.ts', BASE_URL).href, join(PLUGIN_DIR, 'prunus.ts'))
  }

  // ── qwen-code ─────────────────────────────────────────────────────────────────

  if (tool === 'qwen-code') {
    const QWEN_DIR = join(HOME, '.qwen')
    const HOOKS_DIR = join(PRUNUS_DIR, 'hooks', 'qwen-code')
    const QWEN_SETTINGS = join(QWEN_DIR, 'settings.json')

    await installCommand(
      new URL('prunus.md', BASE_URL).href,
      join(QWEN_DIR, 'commands'),
      (s) =>
        s.replaceAll('$ARGUMENTS', '{{args}}').replaceAll('in Bash', 'in a shell').replaceAll(
          'Use Bash only',
          'Use shell only',
        ),
    )

    const settings = await readJsonFile(QWEN_SETTINGS)
    const hooks = (settings.hooks ?? {}) as Record<string, unknown>
    purgeStaleHooks(hooks, HOOKS_DIR, ['UserPromptSubmit'])
    hooks['UserPromptSubmit'] = [{
      hooks: [{
        type: 'command',
        command: `deno run --allow-all --no-check "${join(HOOKS_DIR, 'user-prompt-submit.ts')}"`,
        name: 'prunus-user-prompt-submit',
      }],
    }]
    settings.hooks = hooks

    // Qwen-Code is a Gemini CLI fork; httpUrl selects StreamableHTTP transport
    const mcpServers = (settings.mcpServers ?? {}) as Record<string, unknown>
    const mcpEntry: Record<string, unknown> = { httpUrl: `${url}/mcp` }
    if (token) mcpEntry.headers = { Authorization: `Bearer ${token}` }
    mcpServers.prunus = mcpEntry
    settings.mcpServers = mcpServers

    await writeJsonFile(QWEN_SETTINGS, settings)

    await installSharedFiles()
    try {
      await Deno.remove(HOOKS_DIR, { recursive: true })
      console.log(`purged ${HOOKS_DIR}`)
    } catch { /* not found */ }
    await Deno.mkdir(HOOKS_DIR, { recursive: true })
    await copyOrFetch(
      new URL('hooks/qwen-code/user-prompt-submit.ts', BASE_URL).href,
      join(HOOKS_DIR, 'user-prompt-submit.ts'),
    )
    await cacheHooks([join(HOOKS_DIR, 'user-prompt-submit.ts')])
  }
} // end for (const tool of tools)

console.log('')
console.log('=== post-install ===')
console.log('restart cli tool for mcp to take effect')
console.log('run `/prunus init` in a session to configure prunus for a project')
