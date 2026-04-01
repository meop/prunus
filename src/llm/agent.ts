import { log } from '../log.ts'
import { chatWithTools, type Message, type ToolDefinition } from './chat.ts'

export interface Tool {
  name: string
  description: string
  parameters: Record<string, unknown>
  run: (args: Record<string, unknown>) => Promise<string>
}

const FINISH_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'finish',
    description: 'Call when you have finished all vault updates for this task.',
    parameters: { type: 'object', properties: {} },
  },
}

export async function runAgent(
  systemPrompt: string,
  userMessage: string,
  tools: Tool[],
  maxSteps = 12,
): Promise<void> {
  const toolDefs: ToolDefinition[] = [
    ...tools.map((t) => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.parameters },
    })),
    FINISH_TOOL,
  ]

  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ]

  for (let step = 0; step < maxSteps; step++) {
    const response = await chatWithTools(messages, toolDefs)

    if (!response.tool_calls?.length) break

    messages.push({ role: 'assistant', content: null, tool_calls: response.tool_calls })

    let finished = false
    for (const call of response.tool_calls) {
      if (call.function.name === 'finish') {
        messages.push({ role: 'tool', tool_call_id: call.id, content: 'done' })
        finished = true
        continue
      }

      const tool = tools.find((t) => t.name === call.function.name)
      let result: string
      if (!tool) {
        result = `Unknown tool: ${call.function.name}`
      } else {
        try {
          const args = JSON.parse(call.function.arguments) as Record<string, unknown>
          result = await tool.run(args)
        } catch (err) {
          result = `Error: ${String(err)}`
        }
      }
      log.debug('agent', `${call.function.name} → ${result.slice(0, 120)}`)
      messages.push({ role: 'tool', tool_call_id: call.id, content: result })
    }

    if (finished) break
  }
}
