import { chat } from './chat.ts'

export interface LinkJudgment {
  aLinksToB: boolean
  bLinksToA: boolean
}

const PROMPT = `Given two notes from a developer's knowledge vault, decide if they should reference each other.

Note A: {{pathA}}
{{summaryA}}

Note B: {{pathB}}
{{summaryB}}

Respond with JSON only: {"a_links_to_b": boolean, "b_links_to_a": boolean}

Link if a reader of one would genuinely benefit from reading the other. Do not link just because topics overlap — link if there is a specific conceptual dependency or follow-on worth following.`

export async function judgeLinks(
  a: { path: string; summary: string },
  b: { path: string; summary: string },
): Promise<LinkJudgment> {
  const prompt = PROMPT
    .replace('{{pathA}}', a.path)
    .replace('{{summaryA}}', a.summary)
    .replace('{{pathB}}', b.path)
    .replace('{{summaryB}}', b.summary)

  try {
    const response = await chat([{ role: 'user', content: prompt }])
    const match = response.match(/\{[\s\S]*?\}/)
    if (!match) return { aLinksToB: false, bLinksToA: false }
    const parsed = JSON.parse(match[0])
    return {
      aLinksToB: Boolean(parsed.a_links_to_b),
      bLinksToA: Boolean(parsed.b_links_to_a),
    }
  } catch {
    return { aLinksToB: false, bLinksToA: false }
  }
}
