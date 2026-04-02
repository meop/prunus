const SECTION = '\n\n## See also\n\n'

function parse(body: string): { main: string; links: string[] } {
  const idx = body.indexOf(SECTION)
  if (idx === -1) return { main: body, links: [] }
  const main = body.slice(0, idx)
  const section = body.slice(idx + SECTION.length)
  const links = [...section.matchAll(/^- \[\[([^\]]+)\]\]/gm)].map((m) => m[1])
  return { main, links }
}

function format(main: string, links: string[]): string {
  if (links.length === 0) return main
  return main.trimEnd() + SECTION + links.map((l) => `- [[${l}]]`).format('\n') + '\n'
}

export function getSeeAlsoLinks(body: string): string[] {
  return parse(body).links
}

export function addSeeAlsoLink(body: string, link: string): string {
  const { main, links } = parse(body)
  if (links.includes(link)) return body
  return format(main, [...links, link])
}

export function removeSeeAlsoLink(body: string, link: string): string {
  const { main, links } = parse(body)
  const filtered = links.filter((l) => l !== link)
  if (filtered.length === links.length) return body
  return format(main, filtered)
}
