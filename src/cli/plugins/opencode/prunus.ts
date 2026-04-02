/**
 * Prunus plugin for OpenCode — context injection
 *
 * Drop this file in ~/.config/opencode/plugins/ and it is auto-loaded.
 * No package.json or explicit registration needed.
 *
 * Capabilities:
 *   - Per-prompt: fetches relevant tree notes based on the user's message text
 *     (chat.message → cache notes → experimental.chat.system.transform → inject)
 *
 * Runtime: OpenCode loads plugins in-process via its Bun runtime.
 * fetch and AbortSignal are Bun globals.
 *
 * Configuration: ~/.prunus/settings.json (url, token) and
 * .prunus/settings.json walked up from the session directory (tree, enabled, project).
 * Run /prunus init from any project to enable prunus there.
 */

// deno-lint-ignore-file no-explicit-any no-process-global
import { dirname, join } from 'node:path'

interface PrunusSettings {
  url?: string
  token?: string
  tree?: string
  enabled?: boolean
  project?: string
}

interface ContextNote {
  path: string
  summary: string
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

async function findProjectSettings(cwd: string): Promise<{ settings: PrunusSettings; dir: string | null }> {
  let dir = cwd
  while (true) {
    const s = await readSettingsFile(dir)
    if (Object.keys(s).length > 0) return { settings: s, dir }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return { settings: {}, dir: null }
}

export const prunus = ({ directory }: { directory: string; client: any }) => {
  const HOME = process.env.HOME ?? process.env.USERPROFILE ?? '~'

  let settingsPromise:
    | Promise<{ url: string; token: string; tree: string; enabled: boolean; project: string }>
    | undefined

  function getSettings() {
    if (!settingsPromise) {
      settingsPromise = (async () => {
        const userSettings = await readSettingsFile(HOME)
        const { settings: projectSettings, dir: projectDir } = await findProjectSettings(directory)
        const projectDirName = projectDir?.split('/').filter(Boolean).pop() ?? ''
        return {
          url: userSettings.url ?? 'http://localhost:9100',
          token: userSettings.token ?? '',
          tree: projectSettings.tree ?? userSettings.tree ?? '',
          enabled: projectSettings.enabled ?? userSettings.enabled ?? true,
          project: projectSettings.project ?? projectDirName,
        }
      })()
    }
    return settingsPromise
  }

  function authHeaders(token: string): Record<string, string> {
    return token ? { Authorization: `Bearer ${token}` } : {}
  }

  // Notes fetched for the latest user prompt — updated on each chat.message, read in system.transform
  let cachedNotes: ContextNote[] = []

  return {
    /**
     * Per-prompt: extract user message text, fetch relevant notes, cache for system.transform.
     * chat.message fires after the user message is parsed, before the LLM call.
     */
    'chat.message': async (
      _input: { sessionID: string; messageID?: string },
      output: { parts: Array<{ type: string; text?: string }> },
    ) => {
      const { url, token, tree, enabled } = await getSettings()
      if (!tree || !enabled) return

      const query = output.parts
        .filter((p) => p.type === 'text' && p.text)
        .map((p) => p.text!)
        .join(' ')
        .trim()
      if (!query) return

      try {
        const resp = await fetch(`${url}/tree/${tree}/context?query=${encodeURIComponent(query)}`, {
          headers: authHeaders(token),
          signal: AbortSignal.timeout(8000),
        })
        if (!resp.ok) return
        const data = (await resp.json()) as { notes?: ContextNote[] }
        cachedNotes = data.notes ?? []
      } catch {
        cachedNotes = []
      }
    },

    /**
     * Inject cached notes into the system prompt for the LLM call triggered by this message.
     * system.transform fires after chat.message for the same turn.
     */
    'experimental.chat.system.transform': async (
      _input: { sessionID?: string; model: any },
      output: { system: string[] },
    ) => {
      if (cachedNotes.length === 0) return
      const { tree, project } = await getSettings()
      const notesList = cachedNotes.map((n) => `- ${n.path}: ${n.summary}`).join('\n')
      output.system.push(
        `[prunus tree="${tree}" project="${project}"]\nRelevant tree notes — use read_note MCP tool to retrieve full content:\n${notesList}\n[/prunus]`,
      )
    },
  }
}
