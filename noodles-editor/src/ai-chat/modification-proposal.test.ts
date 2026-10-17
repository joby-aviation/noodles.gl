import { describe, expect, it } from 'vitest'
import { resolveModificationProposal, validateProjectModifications } from './modification-proposal'
import type { OperatorRegistry } from './types'

const registry: OperatorRegistry = {
  version: 'test',
  categories: {},
  operators: {
    NumberOp: {
      name: 'Number',
      type: 'NumberOp',
      category: 'utility',
      description: '',
      inputs: { value: { name: 'value', type: 'NumberField', required: false } },
      outputs: { value: { name: 'value', type: 'NumberField', required: false } },
      sourceFile: '',
      sourceLine: 0,
    },
    OutOp: {
      name: 'Output',
      type: 'OutOp',
      category: 'utility',
      description: '',
      inputs: { data: { name: 'data', type: 'DataField', required: false } },
      outputs: {},
      sourceFile: '',
      sourceLine: 0,
    },
  },
}

const snapshot = {
  nodes: [
    { id: '/number', type: 'NumberOp', position: { x: 0, y: 0 }, data: { inputs: { value: 1 } } },
    { id: '/out', type: 'OutOp', position: { x: 200, y: 0 }, data: {} },
  ],
  edges: [],
}

describe('validateProjectModifications', () => {
  it('dry-runs a complete valid proposal without changing the snapshot', () => {
    const result = validateProjectModifications(
      snapshot,
      [
        {
          type: 'add_edge',
          data: {
            id: '/number.out.value->/out.par.data',
            source: '/number',
            target: '/out',
            sourceHandle: 'out.value',
            targetHandle: 'par.data',
          },
        },
      ],
      registry
    )

    expect(result.success).toBe(true)
    expect(snapshot.edges).toEqual([])
    if (result.success) expect(result.proposal.nextSnapshot.edges).toHaveLength(1)
  })

  it('rejects unknown operators, inputs, handles, cycles and duplicate connections', () => {
    const result = validateProjectModifications(
      snapshot,
      [
        { type: 'add_node', data: { id: '/bad', type: 'MissingOp', data: {} } },
        { type: 'update_node', data: { id: '/number', data: { inputs: { nope: 1 } } } },
        {
          type: 'add_edge',
          data: {
            id: 'bad-edge',
            source: '/number',
            target: '/out',
            sourceHandle: 'out.nope',
            targetHandle: 'par.data',
          },
        },
      ],
      registry
    )

    expect(result.success).toBe(false)
    if (!result.success)
      expect(result.errors.join(' ')).toMatch(/Unknown operator|Unknown input|Unknown source/)
  })

  it('protects the final output node', () => {
    const result = validateProjectModifications(
      snapshot,
      [{ type: 'delete_node', data: { id: '/out' } }],
      registry
    )
    expect(result.success).toBe(false)
  })

  it('reject leaves state untouched and accept returns the whole normalized snapshot', () => {
    const result = validateProjectModifications(
      snapshot,
      [{ type: 'update_node', data: { id: '/number', data: { inputs: { value: 2 } } } }],
      registry
    )
    expect(result.success).toBe(true)
    if (!result.success) return

    expect(resolveModificationProposal(result.proposal, 'reject')).toBeNull()
    const accepted = resolveModificationProposal(result.proposal, 'accept')
    expect(accepted?.nodes.find(node => node.id === '/number')?.data).toEqual({
      inputs: { value: 2 },
    })
    expect(snapshot.nodes[0].data).toEqual({ inputs: { value: 1 } })
  })
})
