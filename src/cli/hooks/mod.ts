/**
 * Prunus shared hook utilities (Deno)
 *
 * Imported by all client hooks. Cross-platform: Windows, macOS, Linux.
 * Install structure expected at runtime:
 *   ~/.prunus/hooks/mod.ts
 *   ~/.prunus/hooks/{tool}/{hook}.ts  ← these import ../mod.ts
 */

import { dirname, join } from '@std/path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HookInput {
  session_id?: string
  transcript_path?: string
  cwd?: string
  hook_event_name?: string
  timestamp?: string
  prompt?: string
}

export interface PrunusSettings {
  token?: string
  enabled?: boolean
  project?: string
  url?: string
  tree?: string
}

export interface PrunusConfig {
  token: string
  enabled: boolean
  project: string
  url: string
  tree: string
}

export interface ContextNote {
  path: string
  summary: string
}

// ---------------------------------------------------------------------------
// Home directory
// ---------------------------------------------------------------------------

export function homeDir(): string {
  return Deno.env.get('HOME') ?? Deno.env.get('USERPROFILE') ?? '.'
}

// ---------------------------------------------------------------------------
// Settings resolution
// ---------------------------------------------------------------------------

async function readSettingsFile(dir: string): Promise<PrunusSettings> {
  try {
    const content = await Deno.readTextFile(join(dir, '.prunus', 'settings.json'))
    return JSON.parse(content) as PrunusSettings
  } catch {
    return {}
  }
}

async function findProjectSettings(cwd: string): Promise<{ settings: PrunusSettings; dir: string | null }> {
  const layers: Array<{ settings: PrunusSettings; dir: string }> = []
  let dir = cwd
  while (true) {
    const s = await readSettingsFile(dir)
    if (Object.keys(s).length > 0) {
      layers.push({ settings: s, dir })
      if (layers.length === 1 && s.enabled === false) break
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  if (layers.length === 0) return { settings: {}, dir: null }
  const merged: PrunusSettings = {}
  for (const { settings } of layers) {
    for (const [k, v] of Object.entries(settings)) {
      if (!(k in merged)) (merged as Record<string, unknown>)[k] = v
    }
  }
  return { settings: merged, dir: layers[0].dir }
}

/**
 * Load merged config: user settings from ~/.prunus/settings.json,
 * project settings merged from all .prunus/settings.json files walking up from cwd (leaf wins).
 * If the leafmost project file sets enabled:false, walking stops immediately.
 * Project settings override user settings for tree/enabled/project.
 * url and token come only from user settings.
 */
export async function loadSettings(cwd: string): Promise<PrunusConfig> {
  const userSettings = await readSettingsFile(homeDir())
  const { settings: projectSettings, dir: projectDir } = await findProjectSettings(cwd)
  const projectDirName = projectDir?.split(/[\\/]/).filter(Boolean).pop() ?? ''

  return {
    url: userSettings.url ?? 'http://localhost:9100',
    token: userSettings.token ?? '',
    tree: projectSettings.tree ?? userSettings.tree ?? '',
    enabled: projectSettings.enabled ?? userSettings.enabled ?? true,
    project: projectSettings.project ?? projectDirName,
  }
}

// ---------------------------------------------------------------------------
// Stdin / hook input
// ---------------------------------------------------------------------------

export async function readStdin(): Promise<string> {
  return await new Response(Deno.stdin.readable).text()
}

export function parseHookInput(raw: string): HookInput {
  try {
    return JSON.parse(raw) as HookInput
  } catch {
    return {}
  }
}

// ---------------------------------------------------------------------------
// Prunus API calls
// ---------------------------------------------------------------------------

function authHeaders(config: PrunusConfig): Record<string, string> {
  return config.token ? { 'Authorization': `Bearer ${config.token}` } : {}
}

/** GET /tree/{tree}/context?query=… — returns relevant tree notes or empty array. */
export async function fetchContext(config: PrunusConfig, query: string): Promise<ContextNote[]> {
  try {
    const url = `${config.url}/tree/${config.tree}/context?query=${encodeURIComponent(query)}`
    const resp = await fetch(url, {
      headers: authHeaders(config),
      signal: AbortSignal.timeout(8000),
    })
    if (!resp.ok) return []
    const data = await resp.json() as { notes?: ContextNote[] }
    return data.notes ?? []
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Hook entry points
// ---------------------------------------------------------------------------

/**
 * Per-prompt context injection entry point.
 * tagStyle: 'xml' for Claude Code (no escaping), 'bracket' for Gemini/Qwen (HTML-escapes < >).
 * output: wraps the context string in the tool-specific JSON envelope.
 */
export async function runContextHook(
  tagStyle: 'xml' | 'bracket',
  output: (ctx: string) => unknown,
): Promise<void> {
  const raw = await readStdin()
  const input = parseHookInput(raw)
  const config = await loadSettings(input.cwd ?? Deno.cwd())
  if (!config.tree || !config.enabled) Deno.exit(0)
  const query = input.prompt?.trim()
  if (!query) Deno.exit(0)
  const notes = await fetchContext(config, query)
  if (notes.length === 0) Deno.exit(0)
  const [open, close] = tagStyle === 'xml'
    ? [`<prunus tree="${config.tree}" project="${config.project}">`, '</prunus>']
    : [`[prunus tree="${config.tree}" project="${config.project}"]`, '[/prunus]']
  const notesList = notes.map((n) => `- ${n.path}: ${n.summary}`).join('\n')
  const ctx = `${open}\nRelevant tree notes — use read_note MCP tool to retrieve full content:\n${notesList}\n${close}`
  console.log(JSON.stringify(output(ctx)))
}
