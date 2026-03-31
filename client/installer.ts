/**
 * Shared installer utilities — used by all client install.ts scripts.
 * No external imports so this works when fetched from a remote URL.
 */

// Cross-platform path helpers (macOS, Linux, Windows)
const isWindows = Deno.build.os === 'windows'
const sep = isWindows ? '\\' : '/'

export function join(...parts: string[]): string {
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

export function fromFileUrl(url: string | URL): string {
  const pathname = decodeURIComponent((url instanceof URL ? url : new URL(url)).pathname)
  if (isWindows) return pathname.slice(1).replaceAll('/', '\\') // /C:/foo → C:\foo
  return pathname
}

export const HOME = Deno.env.get('HOME') ?? Deno.env.get('USERPROFILE') ?? '.'

function ask(message: string): string | null {
  const answer = prompt(message)
  if (answer === null) Deno.exit(0) // Ctrl-C
  return answer
}

/** Prompt for server URL and auth token, showing existing or default values as the default. */
export async function promptConfig(prunusDir: string): Promise<{ prunusUrl: string; authToken: string }> {
  const existing = await readJsonFile(join(prunusDir, 'settings.json'))
  const hasUrl = !!existing.serverUrl
  const defaultUrl = String(existing.serverUrl ?? 'http://localhost:9100')
  const defaultToken = String(existing.authToken ?? '')
  const prunusUrl = ask(`? ${hasUrl ? 'update' : 'set'} prunus server url [${defaultUrl}]:`) || defaultUrl
  const hasToken = !!existing.authToken
  const tokenSuffix = hasToken ? `[${defaultToken}]:` : '(leave empty if none):'
  const authToken = ask(`? ${hasToken ? 'update' : 'set'} auth token ${tokenSuffix}`) || defaultToken
  return { prunusUrl, authToken }
}

function promptUpdate(path: string): boolean {
  const answer = ask(`? update ${path} [y, [n]]:`) ?? ''
  return answer.trim().toLowerCase() !== 'n'
}

async function fetchContent(src: string): Promise<string> {
  if (src.startsWith('file://')) return await Deno.readTextFile(fromFileUrl(src))
  const resp = await fetch(src)
  if (!resp.ok) throw new Error(`Failed to fetch ${src}: ${resp.status} ${resp.statusText}`)
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

/**
 * Copy or fetch a file to a local destination (always overwrites, no prompt).
 * src must be a file:// or http(s):// URL string.
 */
export async function copyOrFetch(src: string, dest: string): Promise<void> {
  await Deno.writeTextFile(dest, await fetchContent(src))
}

/**
 * Copy mod.ts and hooks-deno.json into ~/.prunus/hooks/.
 * clientBaseUrl is a URL string (file:// or https://) pointing to the client/ root.
 */
export async function installSharedFiles(prunusDir: string, clientBaseUrl: string): Promise<void> {
  const sharedDir = join(prunusDir, 'hooks', 'shared')
  await Deno.mkdir(sharedDir, { recursive: true })
  await copyOrFetch(new URL('mod.ts', clientBaseUrl).href, join(sharedDir, 'mod.ts'))

  const hooksDenoJson = join(prunusDir, 'hooks', 'deno.json')
  await copyOrFetch(new URL('hooks-deno.json', clientBaseUrl).href, hooksDenoJson)
}

/**
 * Copy a command file into destDir, creating the directory if needed.
 * srcUrl is a file:// or http(s):// URL string.
 * transform: optional function to modify the file content before writing (e.g. replace arg placeholders).
 */
export async function installCommand(
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

/** Run deno cache --no-check on the given hook files. */
export async function cacheHooks(hookFiles: string[]): Promise<void> {
  const { code } = await new Deno.Command('deno', {
    args: ['cache', '--no-check', ...hookFiles],
    stdout: 'inherit',
    stderr: 'inherit',
  }).output()
  if (code !== 0) {
    console.error('Warning: deno cache failed — hooks will fetch imports on first run')
  }
}

/** Read a JSON file, returning {} if absent or unparseable. */
export async function readJsonFile(path: string): Promise<Record<string, unknown>> {
  try {
    const content = (await Deno.readTextFile(path)).trim()
    if (content) return JSON.parse(content) as Record<string, unknown>
  } catch { /* absent or invalid */ }
  return {}
}

/**
 * Write a JSON file, creating parent directories as needed.
 * Prompts before overwriting existing files; logs "wrote" for new files.
 */
export async function writeJsonFile(path: string, data: Record<string, unknown>): Promise<void> {
  await Deno.mkdir(dirname(path), { recursive: true })
  await writeFile(path, () => Promise.resolve(JSON.stringify(data, null, 2) + '\n'))
}

/** Write ~/.prunus/settings.json with server URL and auth token. */
export async function writeUserSettings(
  prunusDir: string,
  serverUrl: string,
  authToken: string,
): Promise<void> {
  const settings: Record<string, unknown> = { serverUrl }
  if (authToken) settings.authToken = authToken
  await writeJsonFile(join(prunusDir, 'settings.json'), settings)
}
