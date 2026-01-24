import type { Node as ReactFlowNode } from '@xyflow/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Edge } from './noodles'
import { type GeoJsonLayerOp, type IOperator, MathOp, NumberOp, type Operator } from './operators'
import { clearOps, getOpStore } from './store'
import { transformGraph } from './transform-graph'
import { edgeId } from './utils/id-utils'

describe('transform-graph', () => {
  it('handles qualified handle IDs', () => {
    const graph: {
      nodes: ReactFlowNode<Record<string, unknown>>[]
      edges: Edge<Operator<IOperator>, Operator<IOperator>>[]
    } = {
      nodes: [
        { id: '/num', type: 'NumberOp', data: { inputs: { val: 5 } }, position: { x: 0, y: 0 } },
        {
          id: '/add',
          type: 'MathOp',
          data: { inputs: { operator: 'add', b: 10 } },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [
        {
          source: '/num',
          target: '/add',
          sourceHandle: 'out.val',
          targetHandle: 'par.a',
          id: '/num.out.val->/add.par.a',
        },
      ],
    }

    const instances = transformGraph(graph)
    expect(instances).toHaveLength(2)

    const [num, add] = instances
    expect(num).toBeInstanceOf(NumberOp)
    expect(add).toBeInstanceOf(MathOp)
    expect(num.id).toBe('/num')
    expect(add.id).toBe('/add')
  })

  it('throws on connections with invalid handle ID format', () => {
    const graph: {
      nodes: ReactFlowNode<Record<string, unknown>>[]
      edges: Record<string, unknown>[] // Using Record type to test invalid handle IDs
    } = {
      nodes: [
        { id: '/num', type: 'NumberOp', data: { inputs: { val: 5 } }, position: { x: 0, y: 0 } },
        {
          id: '/add',
          type: 'MathOp',
          data: { inputs: { operator: 'add', b: 10 } },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [
        {
          source: '/num',
          target: '/add',
          sourceHandle: 'invalid-format', // Invalid handle ID format
          targetHandle: 'par.a',
          id: 'invalid-edge',
        },
      ],
    }

    expect(() => transformGraph(graph)).toThrow(
      'Invalid handle ID format (invalid-edge) - migration should have converted all handles to qualified format'
    )
  })

  it('generates correct edge IDs with qualified paths', () => {
    const connection = {
      source: '/container/operator1',
      target: '/container/operator2',
      sourceHandle: 'out.data',
      targetHandle: 'par.input',
    }

    const id = edgeId(connection)

    expect(id).toBe('/container/operator1.out.data->/container/operator2.par.input')
  })

  it('handles ReferenceEdges with standard handles', () => {
    const graph: {
      nodes: ReactFlowNode<Record<string, unknown>>[]
      edges: (Edge<Operator<IOperator>, Operator<IOperator>> & { type?: string })[]
    } = {
      nodes: [
        { id: '/num', type: 'NumberOp', data: { inputs: { val: 5 } }, position: { x: 0, y: 0 } },
        {
          id: '/add',
          type: 'MathOp',
          data: { inputs: { operator: 'add', b: 10 } },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [
        {
          source: '/num',
          target: '/add',
          sourceHandle: 'out.val',
          targetHandle: 'par.a',
          // ReferenceEdges use standard handles but render as node-to-node connections
          type: 'ReferenceEdge',
          id: '/num.out.val->/add.par.a',
        } as Edge<Operator<IOperator>, Operator<IOperator>> & { type: string },
      ],
    }

    const instances = transformGraph(graph)
    expect(instances).toHaveLength(2)

    const [num, add] = instances
    expect(num).toBeInstanceOf(NumberOp)
    expect(add).toBeInstanceOf(MathOp)

    // Verify that the reference connection was established
    expect(add.inputs.a.subscriptions.size).toBe(1)
    expect(add.inputs.a.subscriptions.has('/num.out.val->/add.par.a')).toBe(true)
  })

  it('tracks connection errors for incompatible types', () => {
    // Connect a StringOp output to a MathOp number input - type mismatch
    const graph: {
      nodes: ReactFlowNode<Record<string, unknown>>[]
      edges: Edge<Operator<IOperator>, Operator<IOperator>>[]
    } = {
      nodes: [
        {
          id: '/str',
          type: 'StringOp',
          data: { inputs: { val: 'hello' } },
          position: { x: 0, y: 0 },
        },
        {
          id: '/add',
          type: 'MathOp',
          data: { inputs: { operator: 'add', b: 10 } },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [
        {
          source: '/str',
          target: '/add',
          sourceHandle: 'out.val',
          targetHandle: 'par.a',
          id: '/str.out.val->/add.par.a',
        },
      ],
    }

    const instances = transformGraph(graph)
    const add = instances.find(op => op.id === '/add') as MathOp

    // Connection should be established despite type mismatch
    expect(add.inputs.a.subscriptions.size).toBe(1)

    // Connection error should be tracked
    expect(add.hasConnectionErrors()).toBe(true)
    expect(add.connectionErrors.value.size).toBe(1)
    const errorMessage = add.connectionErrors.value.get('/str.out.val->/add.par.a')
    expect(errorMessage).toContain('Type mismatch')
  })

  it('clears connection errors when valid connection replaces invalid one', () => {
    // First create an invalid connection
    const graphWithInvalidConnection: {
      nodes: ReactFlowNode<Record<string, unknown>>[]
      edges: Edge<Operator<IOperator>, Operator<IOperator>>[]
    } = {
      nodes: [
        {
          id: '/str',
          type: 'StringOp',
          data: { inputs: { val: 'hello' } },
          position: { x: 0, y: 0 },
        },
        { id: '/num', type: 'NumberOp', data: { inputs: { val: 5 } }, position: { x: 0, y: 0 } },
        {
          id: '/add',
          type: 'MathOp',
          data: { inputs: { operator: 'add', b: 10 } },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [
        {
          source: '/str',
          target: '/add',
          sourceHandle: 'out.val',
          targetHandle: 'par.a',
          id: '/str.out.val->/add.par.a',
        },
      ],
    }

    transformGraph(graphWithInvalidConnection)

    // Now replace with a valid connection (NumberOp -> MathOp)
    const graphWithValidConnection: {
      nodes: ReactFlowNode<Record<string, unknown>>[]
      edges: Edge<Operator<IOperator>, Operator<IOperator>>[]
    } = {
      nodes: [
        {
          id: '/str',
          type: 'StringOp',
          data: { inputs: { val: 'hello' } },
          position: { x: 0, y: 0 },
        },
        { id: '/num', type: 'NumberOp', data: { inputs: { val: 5 } }, position: { x: 0, y: 0 } },
        {
          id: '/add',
          type: 'MathOp',
          data: { inputs: { operator: 'add', b: 10 } },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [
        {
          source: '/num',
          target: '/add',
          sourceHandle: 'out.val',
          targetHandle: 'par.a',
          id: '/num.out.val->/add.par.a',
        },
      ],
    }

    const instances = transformGraph(graphWithValidConnection)
    const add = instances.find(op => op.id === '/add') as MathOp

    // Valid connection should be established
    expect(add.inputs.a.subscriptions.size).toBe(1)

    // No connection errors should remain
    expect(add.hasConnectionErrors()).toBe(false)
    expect(add.connectionErrors.value.size).toBe(0)
  })

  it('clears connection errors when edge is removed', () => {
    // First create an invalid connection
    const graphWithConnection: {
      nodes: ReactFlowNode<Record<string, unknown>>[]
      edges: Edge<Operator<IOperator>, Operator<IOperator>>[]
    } = {
      nodes: [
        {
          id: '/str',
          type: 'StringOp',
          data: { inputs: { val: 'hello' } },
          position: { x: 0, y: 0 },
        },
        {
          id: '/add',
          type: 'MathOp',
          data: { inputs: { operator: 'add', b: 10 } },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [
        {
          source: '/str',
          target: '/add',
          sourceHandle: 'out.val',
          targetHandle: 'par.a',
          id: '/str.out.val->/add.par.a',
        },
      ],
    }

    transformGraph(graphWithConnection)

    // Now remove the edge
    const graphWithoutConnection: {
      nodes: ReactFlowNode<Record<string, unknown>>[]
      edges: Edge<Operator<IOperator>, Operator<IOperator>>[]
    } = {
      nodes: [
        {
          id: '/str',
          type: 'StringOp',
          data: { inputs: { val: 'hello' } },
          position: { x: 0, y: 0 },
        },
        {
          id: '/add',
          type: 'MathOp',
          data: { inputs: { operator: 'add', b: 10 } },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [], // No edges
    }

    const instances = transformGraph(graphWithoutConnection)
    const add = instances.find(op => op.id === '/add') as MathOp

    // No subscriptions should exist
    expect(add.inputs.a.subscriptions.size).toBe(0)

    // Connection errors should be cleared
    expect(add.hasConnectionErrors()).toBe(false)
    expect(add.connectionErrors.value.size).toBe(0)
  })
})

describe('Field visibility restoration from saved data', () => {
  afterEach(() => {
    clearOps()
  })

  describe('visibleInputs as full set', () => {
    it('uses visibleInputs directly as the full set of visible fields', () => {
      // DeckRendererOp has 'effects' field with showByDefault: false
      // visibleInputs specifies the FULL set of visible fields
      const nodes = [
        {
          id: '/deck-0',
          type: 'DeckRendererOp',
          data: {
            inputs: {},
            visibleInputs: ['effects', 'layers'], // Full set - both should be visible
          },
          position: { x: 0, y: 0 },
        },
      ]

      transformGraph({ nodes, edges: [] })

      const op = getOpStore().getOp('/deck-0')
      expect(op).toBeDefined()
      expect(op!.visibleFields.value).toBeInstanceOf(Set)
      // Both fields should be visible (from visibleInputs)
      expect(op!.visibleFields.value!.has('effects')).toBe(true)
      expect(op!.visibleFields.value!.has('layers')).toBe(true)
      // visibleFields should have exactly these two fields
      expect(op!.visibleFields.value!.size).toBe(2)
    })

    it('visibleInputs with subset of fields hides non-included showByDefault fields', () => {
      // DeckRendererOp has 'layers' with showByDefault: true
      // visibleInputs only includes 'effects', so 'layers' should NOT be visible
      const nodes = [
        {
          id: '/deck-0',
          type: 'DeckRendererOp',
          data: {
            inputs: {},
            visibleInputs: ['effects'], // Only effects, NOT layers
          },
          position: { x: 0, y: 0 },
        },
      ]

      transformGraph({ nodes, edges: [] })

      const op = getOpStore().getOp('/deck-0')
      expect(op).toBeDefined()
      expect(op!.visibleFields.value).toBeInstanceOf(Set)
      // 'effects' should be visible (from visibleInputs)
      expect(op!.visibleFields.value!.has('effects')).toBe(true)
      // 'layers' should NOT be visible (not in visibleInputs)
      expect(op!.visibleFields.value!.has('layers')).toBe(false)
    })

    it('empty visibleInputs array results in no visible fields', () => {
      const nodes = [
        {
          id: '/geojson-0',
          type: 'GeoJsonLayerOp',
          data: {
            inputs: {},
            visibleInputs: [], // Empty - no fields visible
          },
          position: { x: 0, y: 0 },
        },
      ]

      transformGraph({ nodes, edges: [] })

      const op = getOpStore().getOp('/geojson-0') as GeoJsonLayerOp
      expect(op).toBeDefined()
      // visibleFields should be an empty Set (explicit visibility with nothing visible)
      expect(op.visibleFields.value).toBeInstanceOf(Set)
      expect(op.visibleFields.value!.size).toBe(0)
    })
  })

  describe('heuristic-based visibility (no visibleInputs)', () => {
    it('keeps visibleFields.value null when no custom values or connections', () => {
      const nodes = [
        {
          id: '/geojson-0',
          type: 'GeoJsonLayerOp',
          data: {
            inputs: {},
          },
          position: { x: 0, y: 0 },
        },
      ]

      transformGraph({ nodes, edges: [] })

      const op = getOpStore().getOp('/geojson-0') as GeoJsonLayerOp
      expect(op).toBeDefined()
      expect(op.visibleFields.value).toBe(null)
    })

    it('derives visibility from custom values for showByDefault:false fields', () => {
      // DeckRendererOp has 'effects' field with showByDefault: false
      const nodes = [
        {
          id: '/deck-0',
          type: 'DeckRendererOp',
          data: {
            inputs: {
              effects: [{ type: 'lighting' }], // Custom value for showByDefault:false field
            },
          },
          position: { x: 0, y: 0 },
        },
      ]

      transformGraph({ nodes, edges: [] })

      const op = getOpStore().getOp('/deck-0')
      expect(op).toBeDefined()
      // visibleFields should be set because 'effects' has showByDefault:false but has a value
      expect(op!.visibleFields.value).toBeInstanceOf(Set)
      expect(op!.visibleFields.value!.has('effects')).toBe(true)
      // Should also include showByDefault:true fields
      expect(op!.visibleFields.value!.has('layers')).toBe(true)
    })

    it('derives visibility from connections for showByDefault:false fields', () => {
      // DeckRendererOp has 'effects' field with showByDefault: false
      const nodes = [
        {
          id: '/source-0',
          type: 'NumberOp',
          data: { inputs: {} },
          position: { x: 0, y: 0 },
        },
        {
          id: '/deck-0',
          type: 'DeckRendererOp',
          data: { inputs: {} },
          position: { x: 100, y: 0 },
        },
      ]

      const edges = [
        {
          id: '/source-0.out.val->/deck-0.par.effects',
          source: '/source-0',
          target: '/deck-0',
          sourceHandle: 'out.val',
          targetHandle: 'par.effects',
        },
      ]

      transformGraph({ nodes, edges })

      const op = getOpStore().getOp('/deck-0')
      expect(op).toBeDefined()
      // visibleFields should be set because 'effects' has showByDefault:false but has a connection
      expect(op!.visibleFields.value).toBeInstanceOf(Set)
      expect(op!.visibleFields.value!.has('effects')).toBe(true)
    })

    it('does not set visibleFields when only showByDefault:true fields have values', () => {
      const nodes = [
        {
          id: '/num-0',
          type: 'NumberOp',
          data: {
            inputs: {
              val: 42, // 'val' has showByDefault: true
            },
          },
          position: { x: 0, y: 0 },
        },
      ]

      transformGraph({ nodes, edges: [] })

      const op = getOpStore().getOp('/num-0')
      expect(op).toBeDefined()
      // visibleFields should remain null because the heuristic matches defaults
      expect(op!.visibleFields.value).toBe(null)
    })
  })

  describe('auto-show fields on connection', () => {
    it('auto-shows hidden field when it receives a data connection', () => {
      // DeckRendererOp has 'effects' field with showByDefault: false
      const nodes = [
        {
          id: '/source-0',
          type: 'NumberOp',
          data: { inputs: {} },
          position: { x: 0, y: 0 },
        },
        {
          id: '/deck-0',
          type: 'DeckRendererOp',
          data: { inputs: {} },
          position: { x: 100, y: 0 },
        },
      ]

      // First create without connection
      transformGraph({ nodes, edges: [] })

      const op = getOpStore().getOp('/deck-0')
      expect(op).toBeDefined()
      // 'effects' is hidden by default
      expect(op!.inputs.effects.showByDefault).toBe(false)

      // Now add a connection to the hidden 'effects' field
      const edges = [
        {
          id: '/source-0.out.val->/deck-0.par.effects',
          source: '/source-0',
          target: '/deck-0',
          sourceHandle: 'out.val',
          targetHandle: 'par.effects',
        },
      ]

      transformGraph({ nodes, edges })

      // Field should now be visible due to auto-show on connection
      expect(op!.isFieldVisible('effects')).toBe(true)
      expect(op!.visibleFields.value).toBeInstanceOf(Set)
      expect(op!.visibleFields.value!.has('effects')).toBe(true)
    })

    it('does not auto-show for ReferenceEdge connections', () => {
      const nodes = [
        {
          id: '/num',
          type: 'NumberOp',
          data: { inputs: { val: 5 } },
          position: { x: 0, y: 0 },
        },
        {
          id: '/deck-0',
          type: 'DeckRendererOp',
          data: { inputs: {} },
          position: { x: 100, y: 0 },
        },
      ]

      // Create with a ReferenceEdge to hidden field
      const edges = [
        {
          id: '/num.out.val->/deck-0.par.effects',
          source: '/num',
          target: '/deck-0',
          sourceHandle: 'out.val',
          targetHandle: 'par.effects',
          type: 'ReferenceEdge',
        },
      ]

      transformGraph({ nodes, edges })

      const op = getOpStore().getOp('/deck-0')
      expect(op).toBeDefined()

      // ReferenceEdges should not trigger auto-show
      // visibleFields should remain null (using defaults)
      expect(op!.visibleFields.value).toBe(null)
      // 'effects' should still be hidden
      expect(op!.isFieldVisible('effects')).toBe(false)
    })
  })
})
