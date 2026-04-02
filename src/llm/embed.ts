import { SETTINGS } from '../stng.ts'

export async function embed(text: string): Promise<number[]> {
  const response = await fetch(`http://${SETTINGS.llm.hostname}:${SETTINGS.llm.port}/v1/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: SETTINGS.llm.embed.model, input: text }),
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Embed request failed: ${response.status} ${response.statusText}${body ? ` — ${body}` : ''}`)
  }
  const data = (await response.json()) as { data: Array<{ embedding: number[] }> }
  const embedding = data.data[0]?.embedding
  if (!embedding) throw new Error('No embedding returned from embed service')
  return embedding
}
