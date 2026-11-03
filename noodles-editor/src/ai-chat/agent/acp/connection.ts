// JSON-RPC 2.0 over the WebSocket to the local ACP bridge
// (noodles-mcp/src/acp-bridge.ts). The bridge passes messages through to the
// agent's stdio unchanged, so this is the whole ACP transport from the tab's
// side: requests both ways, notifications both ways, one message per frame.

import { debugAiChat } from '../../../utils/debug'

// Close codes the bridge sends, mirrored from acp-bridge.ts
export const CLOSE_AGENT_EXITED = 4001
export const CLOSE_AGENT_FAILED = 4002
export const CLOSE_REPLACED = 4003

export const METHOD_NOT_FOUND = -32601
const INTERNAL_ERROR = -32603

export class AcpError extends Error {
  readonly code: number
  readonly data: unknown

  constructor(code: number, message: string, data?: unknown) {
    super(message)
    this.name = 'AcpError'
    this.code = code
    this.data = data
  }
}

interface Message {
  jsonrpc: '2.0'
  id?: string | number | null
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export interface ConnectionHandlers {
  // Requests the other side sends. Throw an AcpError to answer with an error.
  onRequest: (method: string, params: unknown) => Promise<unknown>
  onNotification: (method: string, params: unknown) => void
  // Not called for a close this side asked for
  onClose: (reason: string) => void
}

export class AcpConnection {
  private socket: WebSocket
  private handlers: ConnectionHandlers
  private nextId = 0
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()
  private closing = false

  private constructor(socket: WebSocket, handlers: ConnectionHandlers) {
    this.socket = socket
    this.handlers = handlers
    socket.addEventListener('message', event => this.receive(event.data))
    socket.addEventListener('close', event => {
      const reason = describeClose(event.code, event.reason)
      for (const { reject } of this.pending.values()) reject(new Error(reason))
      this.pending.clear()
      if (!this.closing) handlers.onClose(reason)
    })
  }

  // Resolves once the socket is open. A browser reports nothing about why a
  // handshake failed (a wrong token and a stopped bridge look the same), so the
  // error names both.
  static open(url: string, handlers: ConnectionHandlers): Promise<AcpConnection> {
    return new Promise((resolve, reject) => {
      let socket: WebSocket
      try {
        socket = new WebSocket(url)
      } catch (error) {
        reject(
          new Error(`That is not a bridge URL: ${error instanceof Error ? error.message : error}`)
        )
        return
      }
      const fail = () =>
        reject(
          new Error(
            'Could not reach the ACP bridge. Check that `noodles-mcp acp` is running and that the URL in Settings, token included, is the one it printed.'
          )
        )
      socket.addEventListener('error', fail, { once: true })
      socket.addEventListener(
        'open',
        () => {
          socket.removeEventListener('error', fail)
          resolve(new AcpConnection(socket, handlers))
        },
        { once: true }
      )
    })
  }

  request<T>(method: string, params: unknown): Promise<T> {
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      this.send({ jsonrpc: '2.0', id, method, params })
    })
  }

  notify(method: string, params: unknown) {
    this.send({ jsonrpc: '2.0', method, params })
  }

  close() {
    this.closing = true
    this.socket.close()
  }

  private send(message: Message) {
    if (this.socket.readyState !== WebSocket.OPEN) return
    this.socket.send(JSON.stringify(message))
  }

  private receive(data: unknown) {
    let message: Message
    try {
      message = JSON.parse(String(data))
    } catch {
      debugAiChat('[acp] ignored a frame that is not JSON')
      return
    }

    if (message.method !== undefined) {
      if (message.id === undefined || message.id === null) {
        this.handlers.onNotification(message.method, message.params)
      } else {
        this.answer(message.id, message.method, message.params)
      }
      return
    }

    if (typeof message.id !== 'number') return
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    if (message.error) {
      const { code, data } = message.error
      pending.reject(new AcpError(code, errorText(message.error), data))
    } else {
      pending.resolve(message.result)
    }
  }

  private async answer(id: string | number, method: string, params: unknown) {
    try {
      const result = await this.handlers.onRequest(method, params)
      this.send({ jsonrpc: '2.0', id, result: result ?? null })
    } catch (error) {
      const code = error instanceof AcpError ? error.code : INTERNAL_ERROR
      const text = error instanceof Error ? error.message : String(error)
      this.send({ jsonrpc: '2.0', id, error: { code, message: text } })
    }
  }
}

// Agents put the useful part in data: claude-agent-acp answers a bad setting
// with "Internal error" and the setting's name in data.details
function errorText(error: { message: string; data?: unknown }): string {
  const { data } = error
  const details =
    typeof data === 'string'
      ? data
      : typeof (data as { details?: unknown })?.details === 'string'
        ? (data as { details: string }).details
        : undefined
  return details ? `${error.message}: ${details}` : error.message
}

function describeClose(code: number, reason: string): string {
  switch (code) {
    case CLOSE_AGENT_EXITED:
    case CLOSE_AGENT_FAILED:
      return reason
    case CLOSE_REPLACED:
      return 'Another tab connected to the ACP bridge and took over the agent.'
    default:
      return 'The ACP bridge stopped. Start `noodles-mcp acp` again, then retry.'
  }
}
