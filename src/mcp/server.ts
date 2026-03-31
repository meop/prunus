import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerTools } from './tools/index.ts'

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'prunus', version: '0.1.0' })
  registerTools(server)
  return server
}
