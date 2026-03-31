export interface Frontmatter {
  id: string
  summary: string
  created: string
  updated: string
  projects: string[]
  tags: string[]
}

export interface ParsedNote {
  frontmatter: Frontmatter
  body: string
}

const FM_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/

export function parseFrontmatter(content: string): ParsedNote {
  const match = content.match(FM_RE)
  if (!match) {
    return { frontmatter: emptyFrontmatter(), body: content }
  }
  return { frontmatter: parseYamlBlock(match[1]), body: match[2] ?? '' }
}

export function emptyFrontmatter(): Frontmatter {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    summary: '',
    created: now,
    updated: now,
    projects: [],
    tags: [],
  }
}

function parseYamlBlock(yaml: string): Frontmatter {
  const fm = emptyFrontmatter()
  let currentList: string[] | null = null

  for (const line of yaml.split('\n')) {
    if (line.startsWith('  - ') && currentList !== null) {
      currentList.push(line.slice(4).trim())
      continue
    }
    currentList = null
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    const val = line.slice(colonIdx + 1).trim()
    switch (key) {
      case 'id':
        fm.id = val || fm.id
        break
      case 'summary':
        fm.summary = unquote(val)
        break
      case 'created':
        fm.created = val || fm.created
        break
      case 'updated':
        fm.updated = val || fm.updated
        break
      case 'projects':
        currentList = fm.projects
        break
      case 'tags':
        currentList = fm.tags
        break
    }
  }
  return fm
}

function unquote(s: string): string {
  if (s.length >= 2 && ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'"))) {
    return s.slice(1, -1)
  }
  return s
}

export function serializeFrontmatter(fm: Frontmatter): string {
  const lines = [
    '---',
    `id: ${fm.id}`,
    `summary: ${JSON.stringify(fm.summary)}`,
    `created: ${fm.created}`,
    `updated: ${fm.updated}`,
    'projects:',
    ...fm.projects.map((p) => `  - ${p}`),
    'tags:',
    ...fm.tags.map((t) => `  - ${t}`),
    '---',
    '',
  ]
  return lines.join('\n')
}

export function buildNoteContent(fm: Frontmatter, body: string): string {
  return serializeFrontmatter(fm) + body
}

const WIKILINK_RE = /\[\[([^\]#|]+?)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g

export function extractWikilinks(body: string): string[] {
  const targets: string[] = []
  for (const match of body.matchAll(WIKILINK_RE)) {
    targets.push(match[1].trim())
  }
  return [...new Set(targets)]
}

export function contentHash(summary: string, body: string): string {
  let h = 5381
  const s = summary + '\n' + body
  for (let i = 0; i < s.length; i++) {
    h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}
