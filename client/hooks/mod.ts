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

export interface Turn {
  role: string
  content: string
  ts: string
}

export interface HookInput {
  session_id?: string
  transcript_path?: string
  cwd?: string
  hook_event_name?: string
  timestamp?: string
}

export interface PrunusSettings {
  serverUrl?: string
  authToken?: string
  vault?: string
  enabled?: boolean
  project?: string
  profile?: string
  markerTtlDays?: number
}

export interface PrunusConfig {
  serverUrl: string
  authToken: string
  vault: string
  enabled: boolean
  project: string
  profile: string
  markerTtlDays: number
}

export interface IngestResult {
  saved?: Array<{ path: string; summary: string }>
  skipped?: number
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

async function findProjectSettings(cwd: string): Promise<PrunusSettings> {
  let dir = cwd
  while (true) {
    const s = await readSettingsFile(dir)
    if (Object.keys(s).length > 0) return s
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return {}
}

/**
 * Load merged config: user settings from ~/.prunus/settings.json,
 * project settings from the nearest .prunus/settings.json walking up from cwd.
 * Project settings override user settings for vault/enabled/project.
 * serverUrl and authToken come only from user settings.
 */
export async function loadSettings(cwd: string): Promise<PrunusConfig> {
  const userSettings = await readSettingsFile(homeDir())
  const projectSettings = await findProjectSettings(cwd)

  return {
    serverUrl: userSettings.serverUrl ?? 'http://localhost:9100',
    authToken: userSettings.authToken ?? '',
    vault: projectSettings.vault ?? userSettings.vault ?? '',
    enabled: projectSettings.enabled ?? userSettings.enabled ?? true,
    project: projectSettings.project ?? cwd.split(/[\\/]/).filter(Boolean).pop() ?? '',
    profile: projectSettings.profile ?? userSettings.profile ?? '',
    markerTtlDays: userSettings.markerTtlDays ?? 30,
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
// Marker files  (~/.prunus/markers/{session_id}.last-ingested)
// ---------------------------------------------------------------------------

function markerDir(): string {
  return join(homeDir(), '.prunus', 'markers')
}

export async function readMarker(sessionId: string): Promise<string> {
  try {
    return (await Deno.readTextFile(join(markerDir(), `${sessionId}.last-ingested`))).trim()
  } catch {
    return ''
  }
}

export async function writeMarker(sessionId: string, ts: string): Promise<void> {
  await Deno.mkdir(markerDir(), { recursive: true })
  await Deno.writeTextFile(join(markerDir(), `${sessionId}.last-ingested`), ts)
}

export async function sweepMarkers(ttlDays: number): Promise<void> {
  const cutoff = Date.now() - ttlDays * 86_400_000
  try {
    for await (const entry of Deno.readDir(markerDir())) {
      if (!entry.isFile || !entry.name.endsWith('.last-ingested')) continue
      const path = join(markerDir(), entry.name)
      try {
        const stat = await Deno.stat(path)
        if ((stat.mtime?.getTime() ?? 0) < cutoff) await Deno.remove(path)
      } catch { /* ignore */ }
    }
  } catch { /* markers dir may not exist yet */ }
}

// ---------------------------------------------------------------------------
// Transcript parsing
// ---------------------------------------------------------------------------

/**
 * Read a Claude-style JSONL transcript, return [turns since `since`, lastTimestamp].
 * Skips meta entries and non-text content blocks.
 */
export async function parseTranscript(
  transcriptPath: string,
  since: string,
): Promise<[Turn[], string]> {
  let text: string
  try {
    text = await Deno.readTextFile(transcriptPath)
  } catch {
    return [[], '']
  }

  const turns: Turn[] = []
  let lastTs = ''

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue

    let entry: Record<string, unknown>
    try {
      entry = JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      continue
    }

    if (entry.isMeta) continue
    if (entry.type !== 'user' && entry.type !== 'assistant') continue

    const ts = typeof entry.timestamp === 'string' ? entry.timestamp : ''
    if (since && ts && ts <= since) continue

    const msg = entry.message as Record<string, unknown> | undefined
    if (!msg) continue
    const role = typeof msg.role === 'string' ? msg.role : ''
    if (role !== 'user' && role !== 'assistant') continue

    const content = msg.content
    let text_: string
    if (typeof content === 'string') {
      text_ = content.trim()
    } else if (Array.isArray(content)) {
      text_ = (content as unknown[])
        .filter(
          (item): item is Record<string, unknown> =>
            typeof item === 'object' && item !== null &&
            (item as Record<string, unknown>).type === 'text',
        )
        .map((item) => String(item.text ?? ''))
        .join(' ')
        .trim()
    } else {
      continue
    }

    if (!text_) continue
    turns.push({ role, content: text_, ts })
    if (ts) lastTs = ts
  }

  return [turns, lastTs]
}

/** Count non-meta user/assistant turns in a transcript (for first-turn detection). */
export async function countTranscriptTurns(transcriptPath: string): Promise<number> {
  let text: string
  try {
    text = await Deno.readTextFile(transcriptPath)
  } catch {
    return 0
  }
  let count = 0
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const e = JSON.parse(trimmed) as Record<string, unknown>
      if (!e.isMeta && (e.type === 'user' || e.type === 'assistant')) count++
    } catch {
      continue
    }
  }
  return count
}

// ---------------------------------------------------------------------------
// Prunus API calls
// ---------------------------------------------------------------------------

function authHeaders(config: PrunusConfig): Record<string, string> {
  return config.authToken ? { 'Authorization': `Bearer ${config.authToken}` } : {}
}

/** GET /vaults/{vault}/context — returns the vault profile string or null. Returns null if no profile configured. */
export async function fetchProfile(config: PrunusConfig): Promise<string | null> {
  if (!config.profile) return null
  try {
    const url = `${config.serverUrl}/vaults/${config.vault}/context?project=${
      encodeURIComponent(config.project)
    }&profile=${encodeURIComponent(config.profile)}`
    const resp = await fetch(url, {
      headers: authHeaders(config),
      signal: AbortSignal.timeout(5000),
    })
    if (!resp.ok) return null
    const data = await resp.json() as { profile?: string }
    return data.profile?.trim() || null
  } catch {
    return null
  }
}

/** POST /vaults/{vault}/ingest — returns result or null on failure. */
export async function ingestTranscript(
  turns: Turn[],
  since: string,
  config: PrunusConfig,
): Promise<IngestResult | null> {
  const body: Record<string, unknown> = { project: config.project, transcript: turns }
  if (since) body.since = since
  if (config.profile) body.profile = config.profile
  try {
    const resp = await fetch(`${config.serverUrl}/vaults/${config.vault}/ingest`, {
      method: 'POST',
      headers: { ...authHeaders(config), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    })
    if (!resp.ok) return null
    return await resp.json() as IngestResult
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Hook entry points — thin wrappers called directly by per-tool hook scripts
// ---------------------------------------------------------------------------

/** Ingest hook entry point: load settings, guard, run ingest. */
export async function runIngestHook(label: string): Promise<void> {
  const raw = await readStdin()
  const input = parseHookInput(raw)
  const config = await loadSettings(input.cwd ?? Deno.cwd())
  if (!config.vault || !config.enabled) Deno.exit(0)
  const transcriptPath = input.transcript_path ?? ''
  const sessionId = input.session_id ?? ''
  if (!transcriptPath || !sessionId) Deno.exit(0)
  await runIngest(transcriptPath, sessionId, config, label)
}

/**
 * First-turn context injection entry point.
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
  if (!config.vault || !config.enabled) Deno.exit(0)
  const transcriptPath = input.transcript_path ?? ''
  const turnCount = transcriptPath ? await countTranscriptTurns(transcriptPath) : 0
  if (turnCount > 2) Deno.exit(0)
  const profile = await fetchProfile(config)
  if (!profile) Deno.exit(0)
  const [open, close] = tagStyle === 'xml'
    ? [`<prunus vault="${config.vault}" project="${config.project}">`, '</prunus>']
    : [`[prunus vault="${config.vault}" project="${config.project}"]`, '[/prunus]']
  const ctx =
    `${open}\n${profile}\nUse search_notes and read_note MCP tools to retrieve specific vault knowledge when relevant.\n${close}`
  console.log(JSON.stringify(output(ctx)))
}

// ---------------------------------------------------------------------------
// Ingest implementation — shared logic for stop/session-end/pre-compact hooks
// ---------------------------------------------------------------------------

/**
 * Run the standard ingest flow: read marker → parse transcript → guard → ingest → write marker.
 */
export async function runIngest(
  transcriptPath: string,
  sessionId: string,
  config: PrunusConfig,
  logPrefix: string,
): Promise<void> {
  await sweepMarkers(config.markerTtlDays)
  const since = await readMarker(sessionId)
  const [turns, lastTs] = await parseTranscript(transcriptPath, since)

  // Skip small sessions that haven't been touched before (noise guard)
  if (turns.length < 4 && !since) return
  if (turns.length < 1) return

  const result = await ingestTranscript(turns, since, config)
  if (!result) {
    Deno.stderr.write(
      new TextEncoder().encode(`${logPrefix} ingest request failed or timed out\n`),
    )
    return
  }

  if (lastTs && sessionId) await writeMarker(sessionId, lastTs)

  if (result.saved?.length) {
    const enc = new TextEncoder()
    Deno.stderr.write(
      enc.encode(`${logPrefix} saved ${result.saved.length} note(s) to ${config.vault}:\n`),
    )
    for (const s of result.saved) {
      Deno.stderr.write(enc.encode(`  - ${s.path}: ${s.summary.slice(0, 80)}\n`))
    }
  }
  if (result.skipped) {
    Deno.stderr.write(
      new TextEncoder().encode(`${logPrefix} skipped ${result.skipped} duplicate(s)\n`),
    )
  }
  if (!result.saved?.length && !result.skipped) {
    Deno.stderr.write(new TextEncoder().encode(`${logPrefix} no notes extracted\n`))
  }
}
