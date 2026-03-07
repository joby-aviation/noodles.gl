// Reference client implementation for external control
// This can be used by external tools like Claude Code to control Noodles

import {
  createMessage,
  type Message,
  MessageMatcher,
  MessageType,
  parseMessage,
  serializeMessage,
} from './message-protocol'

export interface ClientConfig {
  host?: string
  port?: number
  reconnectDelay?: number
  debug?: boolean
  token?: string
}

export interface PipelineSpec {
  nodes: Array<{
    id: string
    type: string
    position?: { x: number; y: number }
    data?: {
      inputs?: Record<string, unknown>
    }
  }>
  edges: Array<{
    id?: string
    source: string
    target: string
    sourceHandle: string
    targetHandle: string
  }>
}

// Noodles External Control Client
//
// Example usage:
// ```javascript
// const client = new NoodlesClient()
// await client.connect()
//
// // Create a data pipeline
// const pipeline = await client.createPipeline({
//   nodes: [
//     { id: '/file', type: 'FileOp', data: { inputs: { url: 'data.csv', format: 'csv' } } },
//     { id: '/filter', type: 'FilterOp', data: { inputs: { expression: 'd.value > 100' } } },
//     { id: '/viz', type: 'ScatterplotLayerOp', data: { inputs: {} } }
//   ],
//   edges: [
//     { source: '/file', target: '/filter', sourceHandle: 'out.data', targetHandle: 'par.data' },
//     { source: '/filter', target: '/viz', sourceHandle: 'out.result', targetHandle: 'par.data' }
//   ]
// })
//
// // Test the pipeline
// const result = await client.testPipeline(pipeline.id, testData)
// ```
export class NoodlesClient {
  private ws: WebSocket | null = null
  private config: Required<ClientConfig>
  private isConnected = false
  private reconnectTimer: NodeJS.Timeout | null = null
  private matcher = new MessageMatcher()
  private eventHandlers = new Map<string, Set<(data: unknown) => void>>()

  constructor(config: ClientConfig = {}) {
    this.config = {
      host: config.host || 'localhost',
      port: config.port || 8765,
      reconnectDelay: config.reconnectDelay || 3000,
      debug: config.debug || false,
    }
  }

  // Connect to Noodles external control server
  connect(url?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = url || `ws://${this.config.host}:${this.config.port}`
      this.log('Connecting to', wsUrl)

      // Extract token from URL if present
      let token: string | null = null
      try {
        const urlObj = new URL(wsUrl)
        token = urlObj.searchParams.get('token')
        if (token) {
          this.config.token = token
        }
      } catch (_error) {
        // URL parsing failed, continue without token
      }

      try {
        this.ws = new WebSocket(wsUrl)

        this.ws.onopen = () => {
          this.log('Connected')
          this.isConnected = true

          // Send connect message
          this.send(
            createMessage(MessageType.CONNECT, {
              clientId: `client-${Date.now()}`,
              version: '1.0.0',
              capabilities: ['pipeline', 'tools', 'state'],
            })
          )

          resolve()
        }

        this.ws.onmessage = event => {
          const message = parseMessage(event.data)
          if (!message) {
            this.log('Invalid message received:', event.data)
            return
          }

          this.handleMessage(message)
        }

        this.ws.onerror = error => {
          this.log('WebSocket error:', error)
          reject(new Error('WebSocket connection failed'))
        }

        this.ws.onclose = event => {
          this.log('Disconnected:', event.code, event.reason)
          this.isConnected = false

          // Attempt reconnection if not a normal closure
          if (event.code !== 1000 && event.code !== 1001) {
            this.scheduleReconnect()
          }
        }
      } catch (error) {
        reject(error)
      }
    })
  }

  // Disconnect from server
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (this.ws) {
      this.ws.close(1000, 'Client disconnecting')
      this.ws = null
    }

    this.isConnected = false
    this.matcher.clear()
  }

  // Check if the client is connected and ready
  isReady(): boolean {
    return this.isConnected && this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  // Wait for the client to be ready
  // timeout: Maximum time to wait in milliseconds (default: 10000)
  // pollInterval: Interval between checks in milliseconds (default: 100)
  waitUntilReady(timeout = 10000, pollInterval = 100): Promise<void> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now()

      const check = () => {
        if (this.isReady()) {
          resolve()
          return
        }

        if (Date.now() - startTime > timeout) {
          reject(new Error('Timeout waiting for client to be ready'))
          return
        }

        setTimeout(check, pollInterval)
      }

      check()
    })
  }

  // ==================== Pipeline Operations ====================

  // Create a pipeline from specification
  async createPipeline(spec: PipelineSpec): Promise<unknown> {
    const message = createMessage(MessageType.PIPELINE_CREATE, {
      spec,
      options: {
        validateFirst: true,
      },
    })

    const response = await this.sendAndWait(message)
    if (response.type === MessageType.TOOL_ERROR) {
      throw new Error(response.payload.error.message)
    }

    return response.payload.result
  }

  // Test a pipeline with sample data
  async testPipeline(pipelineId: string, testData: unknown[]): Promise<unknown> {
    const message = createMessage(MessageType.PIPELINE_TEST, {
      pipelineId,
      testData,
      options: {
        timeout: 30000,
        captureIntermediateResults: true,
      },
    })

    const response = await this.sendAndWait(message)
    if (response.type === MessageType.TOOL_ERROR) {
      throw new Error(response.payload.error.message)
    }

    return response.payload.result
  }

  // Validate a pipeline
  async validatePipeline(pipelineId: string): Promise<unknown> {
    const message = createMessage(MessageType.PIPELINE_VALIDATE, {
      pipelineId,
    })

    const response = await this.sendAndWait(message)
    if (response.type === MessageType.TOOL_ERROR) {
      throw new Error(response.payload.error.message)
    }

    return response.payload.result
  }

  // ==================== Tool Operations ====================

  // Call a tool directly
  async callTool(tool: string, args: Record<string, unknown>): Promise<unknown> {
    const message = createMessage(MessageType.TOOL_CALL, {
      tool,
      args,
      timeout: 30000,
    })

    const response = await this.sendAndWait(message)
    if (response.type === MessageType.TOOL_ERROR) {
      throw new Error(response.payload.error.message)
    }

    return response.payload.result
  }

  // Get current project state
  async getCurrentProject(): Promise<unknown> {
    return this.callTool('getCurrentProject', {})
  }

  // Apply modifications to the project
  async applyModifications(modifications: unknown): Promise<unknown> {
    return this.callTool('applyModifications', { modifications })
  }

  // List all nodes
  async listNodes(): Promise<unknown> {
    return this.callTool('listNodes', {})
  }

  // Get node output
  async getNodeOutput(nodeId: string, outputName = 'result'): Promise<unknown> {
    return this.callTool('getNodeOutput', { nodeId, outputName })
  }

  // Capture visualization screenshot
  async captureVisualization(format = 'png', quality = 0.9): Promise<unknown> {
    return this.callTool('captureVisualization', { format, quality })
  }

  // ==================== Data Operations ====================

  // Upload a data file
  async uploadDataFile(
    filename: string,
    content: string | ArrayBuffer,
    mimeType = 'text/csv'
  ): Promise<unknown> {
    const message = createMessage(MessageType.DATA_UPLOAD, {
      filename,
      content: typeof content === 'string' ? content : this.arrayBufferToBase64(content),
      mimeType,
      encoding: typeof content === 'string' ? 'utf-8' : 'base64',
    })

    const response = await this.sendAndWait(message)
    if (response.type === MessageType.TOOL_ERROR) {
      throw new Error(response.payload.error.message)
    }

    return response.payload.result
  }

  // ==================== State Operations ====================

  // Request current state
  async getState(): Promise<unknown> {
    const message = createMessage(MessageType.STATE_REQUEST, {})
    const response = await this.sendAndWait(message)
    return response.payload
  }

  // Subscribe to state changes
  onStateChange(callback: (state: unknown) => void): void {
    this.on('stateChange', callback)
  }

  // Subscribe to errors
  onError(callback: (error: unknown) => void): void {
    this.on('error', callback)
  }

  // ==================== Private Methods ====================

  private handleMessage(message: Message): void {
    // Check if this is a response to a pending request
    if (this.matcher.handleResponse(message)) {
      return
    }

    // Handle other messages
    switch (message.type) {
      case MessageType.STATE_CHANGE:
        this.emit('stateChange', message.payload)
        break

      case MessageType.ERROR:
        this.emit('error', message.payload)
        break

      case MessageType.STATUS:
        this.emit('status', message.payload)
        break

      case MessageType.LOG:
        if (this.config.debug) {
          console.log('[Server]', message.payload)
        }
        break
    }
  }

  private send(message: Message): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected')
    }

    // Add token to message payload if available
    if (this.config.token && message.payload) {
      ;(message.payload as Record<string, unknown>).token = this.config.token
    }

    this.ws.send(serializeMessage(message))
  }

  private async sendAndWait(message: Message, timeout = 30000): Promise<Message> {
    this.send(message)
    return this.matcher.waitForResponse(message.id, timeout)
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.log('Attempting reconnection...')
      this.connect().catch(error => {
        this.log('Reconnection failed:', error)
        this.scheduleReconnect()
      })
    }, this.config.reconnectDelay)
  }

  private on(event: string, handler: (data: unknown) => void): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set())
    }
    this.eventHandlers.get(event)!.add(handler)
  }

  private emit(event: string, data: unknown): void {
    const handlers = this.eventHandlers.get(event)
    if (handlers) {
      handlers.forEach(handler => {
        handler(data)
      })
    }
  }

  private log(...args: unknown[]): void {
    if (this.config.debug) {
      console.log('[NoodlesClient]', ...args)
    }
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
  }
}

// Export for use in browser or Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { NoodlesClient }
}
