
// Bridge between main thread and WebSocket worker
// Handles communication and tool execution in the main thread


import {
  Message,
  MessageType,
  createMessage,
  createErrorMessage,
  createToolCallMessage,
  ToolCallMessage,
  ToolResponseMessage,
  ToolErrorMessage,
  PipelineCreateMessage,
  PipelineTestMessage,
  DataUploadMessage,
} from './message-protocol'
import { MCPTools } from '../ai-chat/mcp-tools'
import { globalContextManager } from '../ai-chat/global-context-manager'
import { getOpStore } from '../noodles/store'
import { sessionManager } from './session-manager'

// Worker instance
let worker: Worker | null = null
let isInitialized = false

// Event handlers
const eventHandlers = new Map<string, Set<(data: any) => void>>()

// Tool executor instance
let toolExecutor: MCPTools | null = null

// Helper to check if message type requires authentication
const requiresAuth = (type: MessageType): boolean => {
  // These message types don't require auth
  const publicTypes = [
    MessageType.CONNECT,
    MessageType.DISCONNECT,
    MessageType.PING,
    MessageType.PONG,
    MessageType.STATUS,
    MessageType.ERROR,
  ]

  return !publicTypes.includes(type)
}

// Initialize the worker bridge
export const initializeWorkerBridge = async (): Promise<void> => {
  if (isInitialized) return

  try {
    // Create Web Worker
    worker = new Worker(
      new URL('./websocket-worker.ts', import.meta.url),
      { type: 'module' }
    )

    // Initialize tool executor with context loader for full functionality
    // This enables code search, operator schemas, documentation, etc.
    const contextLoader = globalContextManager.getLoader()
    toolExecutor = new MCPTools(contextLoader ?? undefined)

    // Set up message handler
    worker.onmessage = handleWorkerMessage

    // Set up error handler
    worker.onerror = (error) => {
      console.error('[Bridge] Worker error:', error)
      emit('error', { error })
    }

    isInitialized = true
    emit('initialized', {})
  } catch (error) {
    console.error('[Bridge] Failed to initialize worker:', error)
    throw error
  }
}

// Connect to external control server
export const connect = (host = 'localhost', port = 8765): void => {
  if (!worker) {
    throw new Error('Worker bridge not initialized')
  }

  worker.postMessage(
    createMessage(MessageType.CONNECT, { host, port })
  )
}

// Disconnect from external control server
export const disconnect = (): void => {
  if (!worker) return

  worker.postMessage(createMessage(MessageType.DISCONNECT, {}))
}

// Handle messages from worker
const handleWorkerMessage = async (event: MessageEvent) => {
  const message = event.data as Message

  // Check if message requires authentication
  if (requiresAuth(message.type)) {
    // Extract token from message payload if present
    const token = message.payload?.token || message.payload?.auth?.token

    if (!token || !sessionManager.validateToken(token)) {
      sendToWorker(createErrorMessage(
        'Invalid or expired session token',
        'AUTH_FAILED',
        message.id
      ))
      return
    }
  }

  switch (message.type) {
    case MessageType.STATUS:
      emit('status', message.payload)
      break

    case MessageType.ERROR:
      emit('error', message.payload)
      break

    case MessageType.TOOL_CALL:
      await handleToolCall(message as ToolCallMessage)
      break

    case MessageType.PIPELINE_CREATE:
      await handlePipelineCreate(message as PipelineCreateMessage)
      break

    case MessageType.PIPELINE_TEST:
      await handlePipelineTest(message as PipelineTestMessage)
      break

    case MessageType.DATA_UPLOAD:
      await handleDataUpload(message as DataUploadMessage)
      break

    case MessageType.STATE_CHANGE:
      emit('stateChange', message.payload)
      break

    case MessageType.STATE_REQUEST:
      await handleStateRequest(message)
      break

    default:
      console.log('[Bridge] Unhandled message type:', message.type)
  }
}

// Handle tool call from external client
const handleToolCall = async (message: ToolCallMessage) => {
  if (!toolExecutor) {
    sendToWorker(createErrorMessage(
      'Tool executor not initialized',
      'EXECUTOR_NOT_INITIALIZED'
    ))
    return
  }

  const { tool, args } = message.payload
  const startTime = Date.now()

  try {
    // Execute tool
    const result = await executeTool(toolExecutor, tool, args)

    // Send response
    const response: ToolResponseMessage = createMessage(
      MessageType.TOOL_RESPONSE,
      {
        tool,
        result,
        executionTime: Date.now() - startTime,
      },
      message.id
    )
    sendToWorker(response)
  } catch (error) {
    // Send error
    const errorResponse: ToolErrorMessage = createMessage(
      MessageType.TOOL_ERROR,
      {
        tool,
        error: {
          message: error instanceof Error ? error.message : String(error),
          code: 'TOOL_EXECUTION_ERROR',
          details: error instanceof Error ? error.stack : undefined,
        },
      },
      message.id
    )
    sendToWorker(errorResponse)
  }
}

// Execute a tool from MCPTools
const executeTool = async (
  executor: MCPTools,
  toolName: string,
  args: Record<string, any>
): Promise<any> => {
  // Get the tool method
  const tool = (executor as any)[toolName]
  if (typeof tool !== 'function') {
    throw new Error(`Unknown tool: ${toolName}`)
  }

  // Execute the tool
  return await tool.call(executor, args)
}

// Handle pipeline creation
const handlePipelineCreate = async (message: PipelineCreateMessage) => {
  const { spec, options } = message.payload
  const store = getOpStore()

  try {
    const nodes: any[] = []
    const edges: any[] = []
    let yPosition = 100

    // Create data source node
    const sourceNode = {
      id: `/source-${Date.now()}`,
      type: spec.dataSource.type,
      position: { x: 100, y: yPosition },
      data: {
        inputs: spec.dataSource.config,
      },
    }
    nodes.push(sourceNode)
    yPosition += 150

    // Create transformation nodes
    let previousNodeId = sourceNode.id
    for (const transform of spec.transformations) {
      const transformNode = {
        id: `/transform-${Date.now()}-${Math.random()}`,
        type: transform.type,
        position: { x: 100, y: yPosition },
        data: {
          inputs: transform.config,
        },
      }
      nodes.push(transformNode)

      // Create edge from previous node
      if (options?.autoConnect !== false) {
        edges.push({
          id: `${previousNodeId}.out.data->${transformNode.id}.par.data`,
          source: previousNodeId,
          target: transformNode.id,
          sourceHandle: 'out.data',
          targetHandle: 'par.data',
        })
      }

      previousNodeId = transformNode.id
      yPosition += 150
    }

    // Create output node
    const outputNode = {
      id: `/output-${Date.now()}`,
      type: spec.output.type,
      position: { x: 100, y: yPosition },
      data: {
        inputs: spec.output.config,
      },
    }
    nodes.push(outputNode)

    // Connect to output
    if (options?.autoConnect !== false && previousNodeId) {
      edges.push({
        id: `${previousNodeId}.out.data->${outputNode.id}.par.data`,
        source: previousNodeId,
        target: outputNode.id,
        sourceHandle: 'out.data',
        targetHandle: 'par.data',
      })
    }

    // Apply modifications to create the pipeline
    if (toolExecutor) {
      await executeTool(toolExecutor, 'applyModifications', {
        modifications: {
          nodes: nodes.map(n => ({ type: 'add', node: n })),
          edges: edges.map(e => ({ type: 'add', edge: e })),
        },
      })
    }

    // Send response
    sendToWorker(createMessage(
      MessageType.TOOL_RESPONSE,
      {
        tool: 'createPipeline',
        result: {
          pipelineId: outputNode.id,
          nodes: nodes.map(n => n.id),
          edges: edges.map(e => e.id),
        },
        executionTime: 0,
      },
      message.id
    ))
  } catch (error) {
    sendToWorker(createErrorMessage(
      error instanceof Error ? error : 'Failed to create pipeline',
      'PIPELINE_CREATE_ERROR',
      { spec }
    ))
  }
}

// Handle pipeline test
const handlePipelineTest = async (message: PipelineTestMessage) => {
  const { pipelineId, testData, options } = message.payload

  try {
    // Get the pipeline node
    const store = getOpStore()
    const op = store.getOp(pipelineId)

    if (!op) {
      throw new Error(`Pipeline not found: ${pipelineId}`)
    }

    // TODO: Implement test data injection and result capture
    // For now, return a placeholder result
    const result = {
      pipelineId,
      success: true,
      outputs: {},
      errors: [],
      executionTime: 0,
    }

    sendToWorker(createMessage(
      MessageType.TOOL_RESPONSE,
      {
        tool: 'testPipeline',
        result,
        executionTime: 0,
      },
      message.id
    ))
  } catch (error) {
    sendToWorker(createErrorMessage(
      error instanceof Error ? error : 'Failed to test pipeline',
      'PIPELINE_TEST_ERROR',
      { pipelineId }
    ))
  }
}

// Handle data upload
const handleDataUpload = async (message: DataUploadMessage) => {
  const { filename, content, mimeType, encoding } = message.payload

  try {
    // Convert content to appropriate format
    let data: string | ArrayBuffer = content
    if (encoding === 'base64' && typeof content === 'string') {
      // Decode base64
      const binaryString = atob(content)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }
      data = bytes.buffer
    }

    // Store the file (this would need to integrate with the storage system)
    // For now, we'll store it in a temporary location
    const fileUrl = `data://${filename}`

    // TODO: Integrate with actual storage system
    console.log('[Bridge] Data upload:', filename, mimeType, data)

    sendToWorker(createMessage(
      MessageType.TOOL_RESPONSE,
      {
        tool: 'uploadData',
        result: {
          filename,
          url: fileUrl,
          size: typeof data === 'string' ? data.length : data.byteLength,
        },
        executionTime: 0,
      },
      message.id
    ))
  } catch (error) {
    sendToWorker(createErrorMessage(
      error instanceof Error ? error : 'Failed to upload data',
      'DATA_UPLOAD_ERROR',
      { filename }
    ))
  }
}

// Handle state request
const handleStateRequest = async (message: Message) => {
  try {
    if (!toolExecutor) {
      throw new Error('Tool executor not initialized')
    }

    // Get current project state
    const projectState = await executeTool(toolExecutor, 'getCurrentProject', {})

    sendToWorker(createMessage(
      MessageType.STATE_RESPONSE,
      projectState,
      message.id
    ))
  } catch (error) {
    sendToWorker(createErrorMessage(
      error instanceof Error ? error : 'Failed to get state',
      'STATE_REQUEST_ERROR'
    ))
  }
}

// Send message to worker
const sendToWorker = (message: Message) => {
  if (!worker) {
    console.error('[Bridge] Worker not initialized')
    return
  }
  worker.postMessage(message)
}

// Subscribe to events
export const on = (event: string, handler: (data: any) => void): void => {
  if (!eventHandlers.has(event)) {
    eventHandlers.set(event, new Set())
  }
  eventHandlers.get(event)!.add(handler)
}

// Unsubscribe from events
export const off = (event: string, handler: (data: any) => void): void => {
  const handlers = eventHandlers.get(event)
  if (handlers) {
    handlers.delete(handler)
  }
}

// Emit event
const emit = (event: string, data: any): void => {
  const handlers = eventHandlers.get(event)
  if (handlers) {
    handlers.forEach(handler => handler(data))
  }
}

// Clean up resources
export const cleanup = (): void => {
  disconnect()
  if (worker) {
    worker.terminate()
    worker = null
  }
  toolExecutor = null
  isInitialized = false
  eventHandlers.clear()
}