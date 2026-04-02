import { SETTINGS } from '../stng.ts'

export interface TextMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ToolCallMessage {
  role: 'assistant'
  content: null
  tool_calls: ToolCallRequest[]
}

export interface ToolResultMessage {
  role: 'tool'
  tool_call_id: string
  content: string
}

export type Message = TextMessage | ToolCallMessage | ToolResultMessage

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface ToolCallRequest {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ChatResponse {
  content: string | null
  tool_calls?: ToolCallRequest[]
}

async function request(messages: Message[], tools?: ToolDefinition[], temperature = 0.2): Promise<ChatResponse> {
  const body: Record<string, unknown> = { model: SETTINGS.llm.chat.model, messages, temperature }
  if (tools?.length) body.tools = tools

  const response = await fetch(`http://${SETTINGS.llm.hostname}:${SETTINGS.llm.port}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`LLM request failed: ${response.status} ${response.statusText}${text ? ` — ${text}` : ''}`)
  }
  const data = (await response.json()) as {
    choices: Array<{ message: { content: string | null; tool_calls?: ToolCallRequest[] } }>
  }
  const msg = data.choices[0]?.message
  if (!msg) throw new Error('No message in LLM response')
  return { content: msg.content ?? null, tool_calls: msg.tool_calls }
}

export async function chat(messages: TextMessage[], temperature = 0.2): Promise<string> {
  const { content } = await request(messages, undefined, temperature)
  if (!content) throw new Error('No content in LLM response')
  return content
}

export function chatWithTools(
  messages: Message[],
  tools: ToolDefinition[],
  temperature = 0.2,
): Promise<ChatResponse> {
  return request(messages, tools, temperature)
}
