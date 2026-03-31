import { config } from '../config.ts'

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export async function chat(messages: Message[], temperature = 0.2): Promise<string> {
  const response = await fetch(`${config.llm.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.llm.chatModel, messages, temperature }),
  })
  if (!response.ok) throw new Error(`LLM request failed: ${response.status} ${response.statusText}`)
  const data = (await response.json()) as { choices: Array<{ message: { content: string } }> }
  const content = data.choices[0]?.message?.content
  if (!content) throw new Error('No content in LLM response')
  return content
}
