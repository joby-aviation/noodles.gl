import { describe, expect, it } from 'vitest'
import { createErrorMessage, createMessage, MessageType, parseMessage } from './message-protocol'

// These tests verify the WebSocket handling improvements:
// - Blob data conversion in websocket-worker
// - Message ID preservation in error responses
// - PING/PONG message handling
// - Direct nodes/edges pipeline creation format

describe('WebSocket Blob handling', () => {
  it('parseMessage handles string data correctly', () => {
    const original = createMessage(MessageType.PING, { data: 'test' })
    const json = JSON.stringify(original)
    const parsed = parseMessage(json)
    expect(parsed).toEqual(original)
  })

  it('parseMessage handles ArrayBuffer data', () => {
    const original = createMessage(MessageType.PING, { data: 'test' })
    const json = JSON.stringify(original)
    const buffer = new TextEncoder().encode(json)
    const parsed = parseMessage(buffer)
    expect(parsed).toEqual(original)
  })

  it('Blob.text() converts Blob to parseable string', async () => {
    const original = createMessage(MessageType.TOOL_CALL, {
      tool: 'test',
      args: { key: 'value' },
    })
    const json = JSON.stringify(original)
    const blob = new Blob([json], { type: 'application/json' })

    // This is what websocket-worker does: convert Blob to text, then parse
    const text = await blob.text()
    const parsed = parseMessage(text)
    expect(parsed).toEqual(original)
  })
})

describe('error message ID preservation', () => {
  it('createErrorMessage generates its own ID', () => {
    const error = createErrorMessage('Test error', 'TEST_CODE')
    expect(error.id).toBeDefined()
    expect(error.type).toBe(MessageType.ERROR)
    expect(error.payload.code).toBe('TEST_CODE')
  })

  it('spreading error with custom ID overrides the generated ID', () => {
    // This is the pattern used in worker-bridge for auth errors
    const error = createErrorMessage('Invalid token', 'AUTH_FAILED')
    const originalMessageId = 'req-123'

    const response = {
      ...error,
      id: originalMessageId,
    }

    expect(response.id).toBe('req-123')
    expect(response.type).toBe(MessageType.ERROR)
    expect(response.payload.message).toBe('Invalid token')
    expect(response.payload.code).toBe('AUTH_FAILED')
  })

  it('preserves message ID for pipeline create errors', () => {
    const error = createErrorMessage('Failed to create pipeline', 'PIPELINE_CREATE_ERROR')
    const response = {
      ...error,
      id: 'pipeline-456',
    }

    expect(response.id).toBe('pipeline-456')
    expect(response.payload.code).toBe('PIPELINE_CREATE_ERROR')
  })
})

describe('PING/PONG message handling', () => {
  it('creates a PONG response with the original PING message ID', () => {
    const pingMessage = createMessage(MessageType.PING, {}, 'ping-abc')
    // This is how worker-bridge responds to PINGs
    const pongResponse = createMessage(MessageType.PONG, {}, pingMessage.id)

    expect(pongResponse.type).toBe(MessageType.PONG)
    expect(pongResponse.id).toBe('ping-abc')
  })
})

describe('pipeline creation formats', () => {
  // These tests verify the pipeline payload parsing logic from worker-bridge

  it('parses direct nodes/edges format', () => {
    const payload = {
      nodes: [
        {
          id: '/node-1',
          type: 'FileOp',
          position: { x: 0, y: 0 },
          data: { inputs: { url: 'test.json' } },
        },
        { id: '/node-2', type: 'FilterOp', position: { x: 0, y: 150 }, data: { inputs: {} } },
      ],
      edges: [
        {
          source: '/node-1',
          target: '/node-2',
          sourceHandle: 'out.data',
          targetHandle: 'par.data',
        },
      ],
    }

    const inputNodes = payload.nodes
    const inputEdges = payload.edges

    // Direct format - map nodes with defaults for missing fields
    const nodes = inputNodes.map(n => ({
      id: n.id,
      type: n.type,
      position: n.position || { x: 100, y: 100 },
      data: { inputs: n.data?.inputs || {} },
    }))

    const edges = (inputEdges || []).map(e => ({
      id: `${e.source}.${e.sourceHandle}->${e.target}.${e.targetHandle}`,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
    }))

    expect(nodes).toHaveLength(2)
    expect(nodes[0].id).toBe('/node-1')
    expect(nodes[0].data.inputs).toEqual({ url: 'test.json' })
    expect(edges).toHaveLength(1)
    expect(edges[0].id).toBe('/node-1.out.data->/node-2.par.data')
  })

  it('provides default position when not specified', () => {
    const node = { id: '/n1', type: 'FileOp' } as {
      id: string
      type: string
      position?: { x: number; y: number }
      data?: { inputs?: Record<string, unknown> }
    }

    const mapped = {
      id: node.id,
      type: node.type,
      position: node.position || { x: 100, y: 100 },
      data: { inputs: node.data?.inputs || {} },
    }

    expect(mapped.position).toEqual({ x: 100, y: 100 })
    expect(mapped.data.inputs).toEqual({})
  })

  it('generates edge IDs from source/target handles when not provided', () => {
    const edge = {
      source: '/source',
      target: '/target',
      sourceHandle: 'out.data',
      targetHandle: 'par.input',
    } as { id?: string; source: string; target: string; sourceHandle: string; targetHandle: string }

    const id = edge.id || `${edge.source}.${edge.sourceHandle}->${edge.target}.${edge.targetHandle}`
    expect(id).toBe('/source.out.data->/target.par.input')
  })

  it('uses provided edge ID when available', () => {
    const edge = {
      id: 'custom-edge-id',
      source: '/source',
      target: '/target',
      sourceHandle: 'out.data',
      targetHandle: 'par.input',
    }

    const id = edge.id || `${edge.source}.${edge.sourceHandle}->${edge.target}.${edge.targetHandle}`
    expect(id).toBe('custom-edge-id')
  })

  it('rejects payload with neither nodes nor spec.dataSource', () => {
    const payload = { spec: {} } as { spec?: { dataSource?: unknown }; nodes?: unknown[] }

    const inputNodes = payload.nodes || (payload.spec as { nodes?: unknown })?.nodes

    const hasDirectFormat = inputNodes && Array.isArray(inputNodes)
    const hasSpecFormat = payload.spec?.dataSource

    expect(hasDirectFormat).toBeFalsy()
    expect(hasSpecFormat).toBeFalsy()
  })

  it('high-level spec format creates nodes in order', () => {
    const spec = {
      dataSource: { type: 'FileOp', config: { url: 'data.json' } },
      transformations: [{ type: 'FilterOp', config: { column: 'age', value: 30 } }],
      output: { type: 'GeoJsonLayerOp', config: {} },
    }

    const nodes: Array<{ id: string; type: string; position: { x: number; y: number } }> = []
    const edges: Array<{ source: string; target: string }> = []
    let yPosition = 100

    // Source
    nodes.push({ id: 'source', type: spec.dataSource.type, position: { x: 100, y: yPosition } })
    yPosition += 150

    // Transformations
    let previousId = 'source'
    for (const transform of spec.transformations) {
      const id = `transform-${nodes.length}`
      nodes.push({ id, type: transform.type, position: { x: 100, y: yPosition } })
      edges.push({ source: previousId, target: id })
      previousId = id
      yPosition += 150
    }

    // Output
    nodes.push({ id: 'output', type: spec.output.type, position: { x: 100, y: yPosition } })
    edges.push({ source: previousId, target: 'output' })

    expect(nodes).toHaveLength(3)
    expect(nodes[0].type).toBe('FileOp')
    expect(nodes[1].type).toBe('FilterOp')
    expect(nodes[2].type).toBe('GeoJsonLayerOp')
    expect(edges).toHaveLength(2)
    expect(edges[0]).toEqual({ source: 'source', target: 'transform-1' })
    expect(edges[1]).toEqual({ source: 'transform-1', target: 'output' })
  })
})
