// Web Worker for handling WebSocket connections to external tools
// Runs in a separate thread to avoid blocking the main UI

import {
  createErrorMessage,
  createMessage,
  type Message,
  MessageMatcher,
  MessageType,
  parseMessage,
  serializeMessage,
} from './message-protocol'

// Worker state
let ws: WebSocket | null = null
let reconnectTimer: number | null = null
let pingInterval: number | null = null
const matcher = new MessageMatcher()

// Configuration
const CONFIG = {
  reconnectDelay: 3000,
  pingInterval: 30000,
  defaultPort: 8765,
  defaultHost: 'localhost',
}

// Send message to main thread
const postToMain = (message: Message) => {
  self.postMessage(message)
}

// Send message to WebSocket
const sendToWebSocket = (message: Message) => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(serializeMessage(message))
    return true
  }
  return false
}

// Handle connection to WebSocket server
const connect = (url: string) => {
  // Clean up existing connection
  disconnect()

  // Extract token from URL if present
  let token: string | null = null
  try {
    const urlObj = new URL(url)
    token = urlObj.searchParams.get('token')
    console.log('[Worker] Extracted token from URL:', token)
  } catch (error) {
    console.error('[Worker] Invalid URL:', error)
  }

  try {
    ws = new WebSocket(url)

    ws.onopen = () => {
      console.log('[Worker] WebSocket connected to', url)

      // Send connection status to main thread
      postToMain(
        createMessage(MessageType.STATUS, {
          connected: true,
          url,
        })
      )

      // Start ping interval to keep connection alive
      if (pingInterval) clearInterval(pingInterval)
      pingInterval = setInterval(() => {
        sendToWebSocket(createMessage(MessageType.PING, {}))
      }, CONFIG.pingInterval) as unknown as number
    }

    ws.onmessage = async event => {
      let data = event.data

      // Handle Blob data (WebSocket may return Blob)
      if (data instanceof Blob) {
        data = await data.text()
      }

      const message = parseMessage(data)
      if (!message) {
        console.error('[Worker] Invalid message received:', data)
        return
      }

      // Handle ping/pong
      if (message.type === MessageType.PING) {
        sendToWebSocket(createMessage(MessageType.PONG, {}, message.id))
        return
      }

      // Check if this is a response to a pending request
      if (matcher.handleResponse(message)) {
        return
      }

      // Forward message to main thread
      postToMain(message)
    }

    ws.onerror = error => {
      console.error('[Worker] WebSocket error:', error)
      postToMain(createErrorMessage('WebSocket error', 'WS_ERROR', error))
    }

    ws.onclose = event => {
      console.log('[Worker] WebSocket closed:', event.code, event.reason)

      // Clear ping interval
      if (pingInterval) {
        clearInterval(pingInterval)
        pingInterval = null
      }

      // Send disconnection status to main thread
      postToMain(
        createMessage(MessageType.STATUS, {
          connected: false,
          code: event.code,
          reason: event.reason,
        })
      )

      // Attempt reconnection if not a normal closure
      if (event.code !== 1000 && event.code !== 1001) {
        scheduleReconnect(url)
      }
    }
  } catch (error) {
    console.error('[Worker] Failed to create WebSocket:', error)
    postToMain(
      createErrorMessage(
        error instanceof Error ? error : 'Failed to create WebSocket',
        'CONNECTION_FAILED'
      )
    )
  }
}

// Disconnect from WebSocket
const disconnect = () => {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  if (pingInterval) {
    clearInterval(pingInterval)
    pingInterval = null
  }

  if (ws) {
    // Close with normal closure code
    ws.close(1000, 'Disconnecting')
    ws = null
  }

  matcher.clear()
}

// Schedule reconnection attempt
const scheduleReconnect = (url: string) => {
  if (reconnectTimer) return

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    console.log('[Worker] Attempting reconnection to', url)
    connect(url)
  }, CONFIG.reconnectDelay) as unknown as number
}

// Handle messages from main thread
self.onmessage = async (event: MessageEvent) => {
  const message = event.data as Message

  switch (message.type) {
    case MessageType.CONNECT: {
      const messageWithPayload = message as { payload?: { host?: string; port?: number } }
      const { host = CONFIG.defaultHost, port = CONFIG.defaultPort } =
        messageWithPayload.payload || {}
      const url = `ws://${host}:${port}`
      connect(url)
      break
    }

    case MessageType.DISCONNECT:
      disconnect()
      break

    case MessageType.TOOL_CALL:
    case MessageType.PIPELINE_CREATE:
    case MessageType.PIPELINE_TEST:
    case MessageType.PIPELINE_VALIDATE:
    case MessageType.DATA_UPLOAD:
    case MessageType.DATA_QUERY:
    case MessageType.STATE_REQUEST: {
      // Forward to WebSocket and wait for response
      if (sendToWebSocket(message)) {
        try {
          const response = await matcher.waitForResponse(message.id)
          postToMain(response)
        } catch (error) {
          postToMain(
            createErrorMessage(
              error instanceof Error ? error : 'Request failed',
              'REQUEST_FAILED',
              { originalMessage: message }
            )
          )
        }
      } else {
        postToMain(
          createErrorMessage('WebSocket not connected', 'NOT_CONNECTED', {
            originalMessage: message,
          })
        )
      }
      break
    }

    default:
      // Forward any other messages to WebSocket
      if (!sendToWebSocket(message)) {
        postToMain(
          createErrorMessage('Failed to send message: WebSocket not connected', 'SEND_FAILED', {
            originalMessage: message,
          })
        )
      }
  }
}

// Initialize worker
console.log('[Worker] External control WebSocket worker initialized')

// Export for TypeScript
export default null
