import { join } from '@std/path'
import { config } from '../config.ts'
import { log } from '../log.ts'

interface ProfileSections {
  capture: string[]
  skip: string[]
}

function parseSections(content: string): ProfileSections {
  const sections: ProfileSections = { capture: [], skip: [] }
  let current: 'capture' | 'skip' | null = null

  for (const line of content.split('\n')) {
    if (/^## capture/i.test(line)) {
      current = 'capture'
      continue
    }
    if (/^## skip/i.test(line)) {
      current = 'skip'
      continue
    }
    if (/^## /.test(line)) {
      current = null
      continue
    }
    if (current) {
      const trimmed = line.trim()
      if (trimmed) sections[current].push(trimmed)
    }
  }
  return sections
}

function combineSections(profiles: ProfileSections[]): string {
  const capture = profiles.flatMap((p) => p.capture)
  const skip = profiles.flatMap((p) => p.skip)

  const parts: string[] = []
  if (capture.length) {
    parts.push('## Capture\n')
    for (const line of capture) parts.push(line)
  }
  if (skip.length) {
    parts.push('\n## Skip\n')
    for (const line of skip) parts.push(line)
  }
  return parts.join('\n')
}

export async function loadProfile(vault: string): Promise<string> {
  const enabledDir = join(config.vault.base, vault, '.profiles')

  const entries: Deno.DirEntry[] = []
  try {
    for await (const entry of Deno.readDir(enabledDir)) entries.push(entry)
  } catch {
    return ''
  }

  const symlinks = entries.filter((e) => e.isSymlink && e.name.endsWith('.md'))
  if (symlinks.length === 0) return ''

  const parsed: ProfileSections[] = []
  for (const entry of symlinks) {
    try {
      const target = await Deno.readLink(join(enabledDir, entry.name))
      const resolved = target.startsWith('/') ? target : join(enabledDir, target)
      const content = await Deno.readTextFile(resolved)
      parsed.push(parseSections(content))
    } catch (err) {
      log.warn('profiles', `broken symlink ${entry.name}: ${String(err)}`)
    }
  }

  if (parsed.length === 0) return ''
  return combineSections(parsed)
}

export async function listProfileNames(): Promise<string[]> {
  const names = new Set<string>()
  for (const dir of [config.vault.profilesDir, config.vault.secretProfilesDir]) {
    try {
      for await (const entry of Deno.readDir(dir)) {
        if (entry.isFile && entry.name.endsWith('.md')) names.add(entry.name.replace(/\.md$/, ''))
      }
    } catch { /* dir may not exist */ }
  }
  return [...names].sort()
}

export async function listEnabledProfiles(vault: string): Promise<string[]> {
  const enabledDir = join(config.vault.base, vault, '.profiles')
  try {
    const names: string[] = []
    for await (const entry of Deno.readDir(enabledDir)) {
      if (entry.isSymlink && entry.name.endsWith('.md')) names.push(entry.name.replace(/\.md$/, ''))
    }
    return names.sort()
  } catch {
    return []
  }
}

export async function enableProfile(vault: string, name: string): Promise<void> {
  const enabledDir = join(config.vault.base, vault, '.profiles')
  const target = join(enabledDir, `${name}.md`)

  const source = await findProfileFile(name)
  if (!source) throw new Error(`profile "${name}" not found`)

  await Deno.mkdir(enabledDir, { recursive: true })
  try {
    await Deno.remove(target)
  } catch { /* not existing */ }
  await Deno.symlink(source, target)
}

async function findProfileFile(name: string): Promise<string | null> {
  for (const dir of [config.vault.profilesDir, config.vault.secretProfilesDir]) {
    const candidate = join(dir, `${name}.md`)
    try {
      await Deno.stat(candidate)
      return candidate
    } catch { /* not found */ }
  }
  return null
}

export async function disableProfile(vault: string, name: string): Promise<void> {
  const target = join(config.vault.base, vault, '.profiles', `${name}.md`)
  await Deno.remove(target).catch(() => {
    throw new Error(`profile "${name}" not enabled`)
  })
}
