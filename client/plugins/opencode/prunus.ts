/**
 * Prunus plugin for OpenCode
 *
 * Drop this file in ~/.config/opencode/plugins/ and it is auto-loaded.
 * No package.json or explicit registration needed.
 *
 * Capabilities:
 *   - Injects vault profile into the system prompt on every LLM call
 *     (experimental.chat.system.transform — closest equivalent to first-turn injection)
 *   - Ingests session transcript to prunus after each turn
 *     (event: session.idle — incremental, same marker pattern as Claude Code's Stop hook)
 *   - Injects vault profile as context before session compaction
 *     (experimental.session.compacting)
 *
 * Runtime: OpenCode loads plugins in-process via its Bun runtime. This file is NOT run
 * with deno run — it uses Bun globals (Bun.file, Bun.write, Bun.$, process).
 * fetch and AbortSignal are Bun globals.
 *
 * Configuration: ~/.prunus/settings.json (serverUrl, authToken) and
 * .prunus/settings.json walked up from the session directory (vault, enabled, project).
 * Run /prunus init from any project to enable prunus there.
 */

// deno-lint-ignore-file no-explicit-any no-process-global
import { $ } from 'bun'
import { dirname, join } from 'node:path'

interface PrunusSettings {
  serverUrl?: string
  authToken?: string
  vault?: string
  enabled?: boolean
  project?: string
}

async function readSettingsFile(dir: string): Promise<PrunusSettings> {
  try {
    const file = Bun.file(join(dir, '.prunus', 'settings.json'))
    if (!await file.exists()) return {}
    return await file.json() as PrunusSettings
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

export const prunus = ({ directory, client }: { directory: string; client: any }) => {
  const HOME = process.env.HOME ?? process.env.USERPROFILE ?? '~'
  const MARKER_DIR = `${HOME}/.prunus/markers`

  // Settings loaded lazily and cached for the plugin instance lifetime
  let settingsPromise:
    | Promise<{
      serverUrl: string
      authToken: string
      vault: string
      enabled: boolean
      project: string
    }>
    | undefined

  function getSettings() {
    if (!settingsPromise) {
      settingsPromise = (async () => {
        const userSettings = await readSettingsFile(HOME)
        const projectSettings = await findProjectSettings(directory)
        return {
          serverUrl: userSettings.serverUrl ?? 'http://localhost:9100',
          authToken: userSettings.authToken ?? '',
          vault: projectSettings.vault ?? userSettings.vault ?? '',
          enabled: projectSettings.enabled ?? userSettings.enabled ?? true,
          project: projectSettings.project ?? directory.split('/').filter(Boolean).pop() ?? '',
        }
      })()
    }
    return settingsPromise
  }

  function authHeaders(authToken: string): Record<string, string> {
    return authToken ? { Authorization: `Bearer ${authToken}` } : {}
  }

  async function fetchProfile(): Promise<string | null> {
    const { serverUrl, authToken, vault, enabled, project } = await getSettings()
    if (!vault || !enabled) return null
    try {
      const url = `${serverUrl}/vaults/${vault}/context?project=${encodeURIComponent(project)}`
      const resp = await fetch(url, {
        headers: authHeaders(authToken),
        signal: AbortSignal.timeout(5000),
      })
      if (!resp.ok) return null
      const data = (await resp.json()) as { profile?: string }
      return data.profile?.trim() ?? null
    } catch {
      return null
    }
  }

  // Profile fetched once and cached
  let cachedProfile: string | null | undefined = undefined

  async function getCachedProfile(): Promise<string | null> {
    if (cachedProfile !== undefined) return cachedProfile
    cachedProfile = await fetchProfile()
    return cachedProfile
  }

  async function readMarker(sessionID: string): Promise<string> {
    try {
      return (await Bun.file(`${MARKER_DIR}/${sessionID}.last-ingested`).text()).trim()
    } catch {
      return ''
    }
  }

  async function writeMarker(sessionID: string, ts: string): Promise<void> {
    await $`mkdir -p ${MARKER_DIR}`.quiet()
    await Bun.write(`${MARKER_DIR}/${sessionID}.last-ingested`, ts)
  }

  async function ingest(sessionID: string): Promise<void> {
    const { serverUrl, authToken, vault, enabled, project } = await getSettings()
    if (!vault || !enabled) return

    const since = await readMarker(sessionID)

    const result = await client.session.messages({ path: { sessionID } })
    const messages: Array<{ info: any; parts: any[] }> = result.data ?? []
    if (!messages.length) return

    const turns: { role: string; content: string; ts: string }[] = []
    let lastTs = ''

    for (const { info, parts } of messages) {
      if (info.role !== 'user' && info.role !== 'assistant') continue
      const ts = new Date(info.time.created).toISOString()
      if (since && ts <= since) continue

      const text = (parts as any[])
        .filter((p) => p.type === 'text' && !p.synthetic && !p.ignored)
        .map((p) => p.text as string)
        .join(' ')
        .trim()
      if (!text) continue

      turns.push({ role: info.role, content: text, ts })
      lastTs = ts
    }

    // Skip small sessions unless we have a prior marker (i.e. we've already ingested some)
    if (turns.length < 4 && !since) return
    if (turns.length < 1) return

    const body: Record<string, unknown> = { project, transcript: turns }
    if (since) body['since'] = since

    const resp = await fetch(`${serverUrl}/vaults/${vault}/ingest`, {
      method: 'POST',
      headers: { ...authHeaders(authToken), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    }).catch(() => null)

    if (!resp?.ok) return

    if (lastTs) await writeMarker(sessionID, lastTs)

    const data = (await resp.json().catch(() => null)) as {
      saved?: { path: string; summary: string }[]
      skipped?: number
    } | null
    if (data?.saved?.length) {
      console.error(`[prunus] saved ${data.saved.length} note(s)`)
    }
  }

  return {
    /**
     * Inject vault profile into the system prompt on every LLM call.
     * OpenCode has no UserPromptSubmit/BeforeAgent equivalent, so we use the system
     * prompt transform — the profile is always present rather than first-turn only.
     * Profile is fetched once per plugin instance and cached.
     */
    'experimental.chat.system.transform': async (
      _input: { sessionID?: string; model: any },
      output: { system: string[] },
    ) => {
      const { vault, project } = await getSettings()
      const profile = await getCachedProfile()
      if (!profile) return
      output.system.push(
        `[prunus vault="${vault}" project="${project}"]\n${profile}\nUse search_notes and read_note MCP tools to retrieve specific vault knowledge when relevant.\n[/prunus]`,
      )
    },

    /**
     * Ingest session transcript after each agent turn.
     * session.idle fires when the agent finishes a response (like Claude Code's Stop).
     * Uses client.session.messages() — no transcript file needed.
     */
    event: async ({ event }: { event: { type: string; properties: Record<string, any> } }) => {
      if (event.type !== 'session.idle') return
      const sessionID = event.properties.sessionID as string
      if (!sessionID) return
      await ingest(sessionID).catch(() => {})
    },

    /**
     * Inject vault profile into the compaction context.
     * Ensures the profile is preserved across context window resets.
     */
    'experimental.session.compacting': async (
      _input: { sessionID: string },
      output: { context: string[]; prompt?: string },
    ) => {
      const { vault, project } = await getSettings()
      const profile = await getCachedProfile()
      if (!profile) return
      output.context.push(
        `[prunus vault="${vault}" project="${project}"]\n${profile}\nUse search_notes and read_note MCP tools to retrieve specific vault knowledge when relevant.\n[/prunus]`,
      )
    },
  }
}
