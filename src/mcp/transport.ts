import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'

// Stateless request/response transport for Deno.serve HTTP handlers.
// One instance per request: connect → dispatch → done.
export class RequestTransport implements Transport {
  private _resolve?: (message: JSONRPCMessage) => void

  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage) => void

  start(): Promise<void> {
    return Promise.resolve()
  }

  send(message: JSONRPCMessage): Promise<void> {
    this._resolve?.(message)
    this._resolve = undefined
    return Promise.resolve()
  }

  close(): Promise<void> {
    this.onclose?.()
    return Promise.resolve()
  }

  dispatch(message: JSONRPCMessage): Promise<JSONRPCMessage | null> {
    // Notifications have no id and expect no response
    if (!('id' in message)) {
      this.onmessage?.(message)
      return Promise.resolve(null)
    }
    return new Promise((resolve, reject) => {
      this._resolve = resolve
      this.onerror = reject
      this.onmessage?.(message)
    })
  }
}
