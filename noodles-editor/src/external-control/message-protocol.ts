// Message protocol for external control communication
// Defines the structure of messages between external tools and Noodles

export enum MessageType {
  // Connection management
  CONNECT = 'connect',
  DISCONNECT = 'disconnect',
  PING = 'ping',
  PONG = 'pong',

  // Tool execution
  TOOL_CALL = 'tool_call',
  TOOL_RESPONSE = 'tool_response',
  TOOL_ERROR = 'tool_error',

  // Project state
  STATE_CHANGE = 'state_change',
  STATE_REQUEST = 'state_request',
  STATE_RESPONSE = 'state_response',

  // Pipeline operations
  PIPELINE_CREATE = 'pipeline_create',
  PIPELINE_RUN = 'pipeline_run',
  PIPELINE_TEST = 'pipeline_test',
  PIPELINE_VALIDATE = 'pipeline_validate',

  // Data operations
  DATA_UPLOAD = 'data_upload',
  DATA_QUERY = 'data_query',

  // System messages
  ERROR = 'error',
  LOG = 'log',
  STATUS = 'status',
}

export interface BaseMessage {
  id: string
  type: MessageType
  timestamp: number
}

export interface ConnectMessage extends BaseMessage {
  type: MessageType.CONNECT
  payload: {
    clientId: string
    version: string
    capabilities?: string[]
  }
}

export interface ToolCallMessage extends BaseMessage {
  type: MessageType.TOOL_CALL
  payload: {
    tool: string
    args: Record<string, any>
    timeout?: number
  }
}

export interface ToolResponseMessage extends BaseMessage {
  type: MessageType.TOOL_RESPONSE
  payload: {
    tool: string
    result: any
    executionTime: number
  }
}

export interface ToolErrorMessage extends BaseMessage {
  type: MessageType.TOOL_ERROR
  payload: {
    tool: string
    error: {
      message: string
      code?: string
      details?: any
    }
  }
}

export interface StateChangeMessage extends BaseMessage {
  type: MessageType.STATE_CHANGE
  payload: {
    path: string[]
    value: any
    operation: 'set' | 'delete' | 'push' | 'splice'
  }
}

export interface PipelineCreateMessage extends BaseMessage {
  type: MessageType.PIPELINE_CREATE
  payload: {
    spec: {
      dataSource: {
        type: string
        config: Record<string, any>
      }
      transformations: Array<{
        type: string
        config: Record<string, any>
      }>
      output: {
        type: string
        config: Record<string, any>
      }
    }
    options?: {
      validateFirst?: boolean
      autoConnect?: boolean
    }
  }
}

export interface PipelineTestMessage extends BaseMessage {
  type: MessageType.PIPELINE_TEST
  payload: {
    pipelineId: string
    testData: any[]
    options?: {
      timeout?: number
      captureIntermediateResults?: boolean
    }
  }
}

export interface DataUploadMessage extends BaseMessage {
  type: MessageType.DATA_UPLOAD
  payload: {
    filename: string
    content: string | ArrayBuffer
    mimeType?: string
    encoding?: 'utf-8' | 'base64' | 'binary'
  }
}

export interface ErrorMessage extends BaseMessage {
  type: MessageType.ERROR
  payload: {
    message: string
    code?: string
    stack?: string
    context?: any
  }
}

export type Message =
  | ConnectMessage
  | ToolCallMessage
  | ToolResponseMessage
  | ToolErrorMessage
  | StateChangeMessage
  | PipelineCreateMessage
  | PipelineTestMessage
  | DataUploadMessage
  | ErrorMessage
  | BaseMessage

// Message factory functions
export const createMessage = <T extends Message>(
  type: MessageType,
  payload: any,
  id?: string
): T => {
  return {
    id: id || generateMessageId(),
    type,
    timestamp: Date.now(),
    payload,
  } as T
}

export const createErrorMessage = (
  error: Error | string,
  code?: string,
  context?: any
): ErrorMessage => {
  return createMessage(MessageType.ERROR, {
    message: typeof error === 'string' ? error : error.message,
    code,
    stack: typeof error === 'object' ? error.stack : undefined,
    context,
  })
}

export const createToolCallMessage = (
  tool: string,
  args: Record<string, any>,
  timeout?: number
): ToolCallMessage => {
  return createMessage(MessageType.TOOL_CALL, {
    tool,
    args,
    timeout,
  })
}

// Utility functions
export const generateMessageId = (): string => {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

export const isValidMessage = (data: any): data is Message => {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof data.id === 'string' &&
    typeof data.type === 'string' &&
    typeof data.timestamp === 'number' &&
    Object.values(MessageType).includes(data.type)
  )
}

export const parseMessage = (data: string | ArrayBuffer): Message | null => {
  try {
    const text = typeof data === 'string' ? data : new TextDecoder().decode(data)
    const parsed = JSON.parse(text)
    return isValidMessage(parsed) ? parsed : null
  } catch {
    return null
  }
}

export const serializeMessage = (message: Message): string => {
  return JSON.stringify(message)
}

// Response matcher for request-response patterns
export class MessageMatcher {
  private pending = new Map<string, {
    resolve: (msg: Message) => void
    reject: (error: Error) => void
    timeout: NodeJS.Timeout
  }>()

  waitForResponse(
    requestId: string,
    timeout = 30000
  ): Promise<Message> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`Response timeout for message ${requestId}`))
      }, timeout)

      this.pending.set(requestId, { resolve, reject, timeout: timer })
    })
  }

  handleResponse(message: Message): boolean {
    const handler = this.pending.get(message.id)
    if (handler) {
      clearTimeout(handler.timeout)
      this.pending.delete(message.id)
      handler.resolve(message)
      return true
    }
    return false
  }

  clear(): void {
    for (const handler of this.pending.values()) {
      clearTimeout(handler.timeout)
    }
    this.pending.clear()
  }
}