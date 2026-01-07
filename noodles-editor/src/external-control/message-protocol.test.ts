import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createErrorMessage,
  createMessage,
  createToolCallMessage,
  generateMessageId,
  isValidMessage,
  MessageMatcher,
  MessageType,
  parseMessage,
  serializeMessage,
  type BaseMessage,
  type ErrorMessage,
  type Message,
  type ToolCallMessage,
} from './message-protocol'

describe('MessageType enum', () => {
  it('includes all connection management types', () => {
    expect(MessageType.CONNECT).toBe('connect')
    expect(MessageType.DISCONNECT).toBe('disconnect')
    expect(MessageType.PING).toBe('ping')
    expect(MessageType.PONG).toBe('pong')
  })

  it('includes all tool execution types', () => {
    expect(MessageType.TOOL_CALL).toBe('tool_call')
    expect(MessageType.TOOL_RESPONSE).toBe('tool_response')
    expect(MessageType.TOOL_ERROR).toBe('tool_error')
  })

  it('includes all project state types', () => {
    expect(MessageType.STATE_CHANGE).toBe('state_change')
    expect(MessageType.STATE_REQUEST).toBe('state_request')
    expect(MessageType.STATE_RESPONSE).toBe('state_response')
  })

  it('includes all pipeline operation types', () => {
    expect(MessageType.PIPELINE_CREATE).toBe('pipeline_create')
    expect(MessageType.PIPELINE_RUN).toBe('pipeline_run')
    expect(MessageType.PIPELINE_TEST).toBe('pipeline_test')
    expect(MessageType.PIPELINE_VALIDATE).toBe('pipeline_validate')
  })

  it('includes all data operation types', () => {
    expect(MessageType.DATA_UPLOAD).toBe('data_upload')
    expect(MessageType.DATA_QUERY).toBe('data_query')
  })

  it('includes all system message types', () => {
    expect(MessageType.ERROR).toBe('error')
    expect(MessageType.LOG).toBe('log')
    expect(MessageType.STATUS).toBe('status')
  })
})

describe('generateMessageId', () => {
  it('generates unique IDs', () => {
    const id1 = generateMessageId()
    const id2 = generateMessageId()
    expect(id1).not.toBe(id2)
  })

  it('generates IDs with expected format', () => {
    const id = generateMessageId()
    // Format: timestamp-randomString
    expect(id).toMatch(/^\d+-[a-z0-9]+$/)
  })
})

describe('createMessage', () => {
  it('creates a message with required fields', () => {
    const msg = createMessage(MessageType.PING, { data: 'test' })

    expect(msg.type).toBe(MessageType.PING)
    expect(msg.payload).toEqual({ data: 'test' })
    expect(msg.id).toBeDefined()
    expect(msg.timestamp).toBeDefined()
    expect(typeof msg.timestamp).toBe('number')
  })

  it('uses provided ID if specified', () => {
    const msg = createMessage(MessageType.PING, {}, 'custom-id')
    expect(msg.id).toBe('custom-id')
  })

  it('generates timestamp close to current time', () => {
    const before = Date.now()
    const msg = createMessage(MessageType.PING, {})
    const after = Date.now()

    expect(msg.timestamp).toBeGreaterThanOrEqual(before)
    expect(msg.timestamp).toBeLessThanOrEqual(after)
  })
})

describe('createErrorMessage', () => {
  it('creates error message from string', () => {
    const msg = createErrorMessage('Test error')

    expect(msg.type).toBe(MessageType.ERROR)
    expect(msg.payload.message).toBe('Test error')
    expect(msg.payload.code).toBeUndefined()
    expect(msg.payload.stack).toBeUndefined()
  })

  it('creates error message from Error object', () => {
    const error = new Error('Test error')
    const msg = createErrorMessage(error)

    expect(msg.type).toBe(MessageType.ERROR)
    expect(msg.payload.message).toBe('Test error')
    expect(msg.payload.stack).toBeDefined()
    expect(msg.payload.stack).toContain('Error: Test error')
  })

  it('includes code and context when provided', () => {
    const msg = createErrorMessage('Test error', 'ERR_CODE', { key: 'value' })

    expect(msg.payload.code).toBe('ERR_CODE')
    expect(msg.payload.context).toEqual({ key: 'value' })
  })
})

describe('createToolCallMessage', () => {
  it('creates tool call message with required fields', () => {
    const msg = createToolCallMessage('testTool', { arg1: 'value1' })

    expect(msg.type).toBe(MessageType.TOOL_CALL)
    expect(msg.payload.tool).toBe('testTool')
    expect(msg.payload.args).toEqual({ arg1: 'value1' })
    expect(msg.payload.timeout).toBeUndefined()
  })

  it('includes timeout when specified', () => {
    const msg = createToolCallMessage('testTool', {}, 5000)

    expect(msg.payload.timeout).toBe(5000)
  })
})

describe('isValidMessage', () => {
  it('returns true for valid messages', () => {
    const validMessage: BaseMessage = {
      id: 'test-id',
      type: MessageType.PING,
      timestamp: Date.now(),
    }
    expect(isValidMessage(validMessage)).toBe(true)
  })

  it('returns false for null', () => {
    expect(isValidMessage(null)).toBe(false)
  })

  it('returns false for non-objects', () => {
    expect(isValidMessage('string')).toBe(false)
    expect(isValidMessage(123)).toBe(false)
    expect(isValidMessage(undefined)).toBe(false)
  })

  it('returns false for missing id', () => {
    expect(isValidMessage({ type: MessageType.PING, timestamp: Date.now() })).toBe(false)
  })

  it('returns false for missing type', () => {
    expect(isValidMessage({ id: 'test', timestamp: Date.now() })).toBe(false)
  })

  it('returns false for missing timestamp', () => {
    expect(isValidMessage({ id: 'test', type: MessageType.PING })).toBe(false)
  })

  it('returns false for invalid type', () => {
    expect(isValidMessage({ id: 'test', type: 'invalid_type', timestamp: Date.now() })).toBe(false)
  })

  it('returns false for non-string id', () => {
    expect(isValidMessage({ id: 123, type: MessageType.PING, timestamp: Date.now() })).toBe(false)
  })

  it('returns false for non-number timestamp', () => {
    expect(isValidMessage({ id: 'test', type: MessageType.PING, timestamp: 'not-a-number' })).toBe(
      false
    )
  })
})

describe('parseMessage', () => {
  it('parses valid JSON string messages', () => {
    const original: BaseMessage = {
      id: 'test-id',
      type: MessageType.TOOL_CALL,
      timestamp: Date.now(),
    }
    const json = JSON.stringify(original)
    const parsed = parseMessage(json)

    expect(parsed).toEqual(original)
  })

  it('parses ArrayBuffer messages', () => {
    const original: BaseMessage = {
      id: 'test-id',
      type: MessageType.PING,
      timestamp: Date.now(),
    }
    const json = JSON.stringify(original)
    const buffer = new TextEncoder().encode(json)
    const parsed = parseMessage(buffer)

    expect(parsed).toEqual(original)
  })

  it('returns null for invalid JSON', () => {
    expect(parseMessage('not valid json')).toBeNull()
  })

  it('returns null for valid JSON but invalid message structure', () => {
    expect(parseMessage(JSON.stringify({ foo: 'bar' }))).toBeNull()
  })
})

describe('serializeMessage', () => {
  it('serializes message to JSON string', () => {
    const msg = createMessage(MessageType.PING, { data: 'test' }, 'test-id')
    const serialized = serializeMessage(msg)
    const parsed = JSON.parse(serialized)

    expect(parsed.id).toBe('test-id')
    expect(parsed.type).toBe(MessageType.PING)
    expect(parsed.payload).toEqual({ data: 'test' })
  })

  it('produces valid JSON that can be parsed back', () => {
    const original = createToolCallMessage('myTool', { arg: 'value' })
    const serialized = serializeMessage(original)
    const parsed = parseMessage(serialized)

    expect(parsed).toEqual(original)
  })
})

describe('MessageMatcher', () => {
  let matcher: MessageMatcher

  beforeEach(() => {
    matcher = new MessageMatcher()
    vi.useFakeTimers()
  })

  afterEach(() => {
    matcher.clear()
    vi.useRealTimers()
  })

  it('resolves when matching response received', async () => {
    const requestId = 'req-123'

    const promise = matcher.waitForResponse(requestId, 5000)

    const response: Message = {
      id: requestId,
      type: MessageType.TOOL_RESPONSE,
      timestamp: Date.now(),
      payload: { result: 'success' },
    }

    const handled = matcher.handleResponse(response)
    expect(handled).toBe(true)

    const result = await promise
    expect(result).toEqual(response)
  })

  it('rejects on timeout', async () => {
    const requestId = 'req-456'
    const promise = matcher.waitForResponse(requestId, 1000)

    // Advance time past timeout
    vi.advanceTimersByTime(1100)

    await expect(promise).rejects.toThrow(`Response timeout for message ${requestId}`)
  })

  it('returns false when no matching handler exists', () => {
    const response: Message = {
      id: 'unknown-id',
      type: MessageType.TOOL_RESPONSE,
      timestamp: Date.now(),
    }

    const handled = matcher.handleResponse(response)
    expect(handled).toBe(false)
  })

  it('clears pending handlers on clear()', async () => {
    const requestId = 'req-789'
    const promise = matcher.waitForResponse(requestId, 30000)

    matcher.clear()

    // Response should not be handled after clear
    const response: Message = {
      id: requestId,
      type: MessageType.TOOL_RESPONSE,
      timestamp: Date.now(),
    }

    const handled = matcher.handleResponse(response)
    expect(handled).toBe(false)

    // Promise should still be pending (not rejected by clear)
    // Advance time to trigger timeout
    vi.advanceTimersByTime(31000)

    // After clear, the timeout should not fire (cleared)
    // The promise remains unresolved forever, which is expected behavior
  })

  it('handles multiple concurrent requests', async () => {
    const promise1 = matcher.waitForResponse('req-1', 5000)
    const promise2 = matcher.waitForResponse('req-2', 5000)
    const promise3 = matcher.waitForResponse('req-3', 5000)

    const response2: Message = {
      id: 'req-2',
      type: MessageType.TOOL_RESPONSE,
      timestamp: Date.now(),
      payload: { data: 'response2' },
    }

    matcher.handleResponse(response2)
    const result2 = await promise2
    expect(result2.payload).toEqual({ data: 'response2' })

    const response1: Message = {
      id: 'req-1',
      type: MessageType.TOOL_RESPONSE,
      timestamp: Date.now(),
      payload: { data: 'response1' },
    }

    matcher.handleResponse(response1)
    const result1 = await promise1
    expect(result1.payload).toEqual({ data: 'response1' })

    // req-3 should timeout
    vi.advanceTimersByTime(6000)
    await expect(promise3).rejects.toThrow('Response timeout for message req-3')
  })

  it('only handles each response once', async () => {
    const requestId = 'req-single'
    const promise = matcher.waitForResponse(requestId, 5000)

    const response: Message = {
      id: requestId,
      type: MessageType.TOOL_RESPONSE,
      timestamp: Date.now(),
    }

    // First handling succeeds
    expect(matcher.handleResponse(response)).toBe(true)

    // Second handling fails (already handled)
    expect(matcher.handleResponse(response)).toBe(false)

    await promise
  })
})
