import { describe, expect, it } from 'vitest'
import { parseModifications, validateModification } from './types'

describe('parseModifications', () => {
  it('parses valid modifications array from object', () => {
    const input = {
      modifications: [
        { type: 'add_node', data: { id: '/node-1', type: 'NumberOp' } },
        { type: 'delete_node', data: { id: '/node-2' } },
      ],
    }

    const result = parseModifications(input)

    expect(result).toHaveLength(2)
    expect(result?.[0].type).toBe('add_node')
    expect(result?.[1].type).toBe('delete_node')
  })

  it('parses valid modifications from direct array', () => {
    const input = [
      { type: 'add_node', data: { id: '/node-1', type: 'CodeOp' } },
      { type: 'add_edge', data: { id: 'edge-1', source: '/a', target: '/b' } },
    ]

    const result = parseModifications(input)

    expect(result).toHaveLength(2)
  })

  it('parses valid modifications from JSON string', () => {
    const input = JSON.stringify({
      modifications: [{ type: 'delete_edge', data: { id: 'edge-1' } }],
    })

    const result = parseModifications(input)

    expect(result).toHaveLength(1)
    expect(result?.[0].type).toBe('delete_edge')
  })

  it('returns null for invalid modification type', () => {
    const input = {
      modifications: [{ type: 'invalid_type', data: {} }],
    }

    const result = parseModifications(input)

    expect(result).toBeNull()
  })

  it('returns null for missing required data fields', () => {
    const input = {
      modifications: [{ type: 'add_node', data: { type: 'NumberOp' } }], // missing id
    }

    const result = parseModifications(input)

    expect(result).toBeNull()
  })

  it('returns null for malformed JSON string', () => {
    const input = '{ invalid json }'

    const result = parseModifications(input)

    expect(result).toBeNull()
  })

  it('returns null for non-object input', () => {
    expect(parseModifications(null)).toBeNull()
    expect(parseModifications(123)).toBeNull()
    expect(parseModifications('not json')).toBeNull()
  })

  it('validates update_node with partial data', () => {
    const input = {
      modifications: [
        {
          type: 'update_node',
          data: { id: '/node-1', position: { x: 100, y: 200 } },
        },
      ],
    }

    const result = parseModifications(input)

    expect(result).toHaveLength(1)
    expect(result?.[0].type).toBe('update_node')
  })

  it('validates edge with optional handles', () => {
    const input = {
      modifications: [
        {
          type: 'add_edge',
          data: {
            id: 'edge-1',
            source: '/a',
            target: '/b',
            sourceHandle: 'out.data',
            targetHandle: 'par.input',
          },
        },
      ],
    }

    const result = parseModifications(input)

    expect(result).toHaveLength(1)
    const edge = result?.[0]
    if (edge?.type === 'add_edge') {
      expect(edge.data.sourceHandle).toBe('out.data')
      expect(edge.data.targetHandle).toBe('par.input')
    }
  })
})

describe('validateModification', () => {
  it('validates a single add_node modification', () => {
    const mod = { type: 'add_node', data: { id: '/test', type: 'NumberOp' } }

    const result = validateModification(mod)

    expect(result).not.toBeNull()
    expect(result?.type).toBe('add_node')
  })

  it('returns null for invalid modification', () => {
    const mod = { type: 'add_node', data: {} } // missing id and type

    const result = validateModification(mod)

    expect(result).toBeNull()
  })
})
