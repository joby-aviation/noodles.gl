// Tests for operator-node synchronization
// These tests ensure that when we refactor to make operators the source of truth,
// all existing flows continue to work correctly.

import { beforeEach, describe, expect, it } from 'vitest'
import { useGraphStore } from './graph-store'
import { NumberOp } from './operators'
import { transformGraph } from './transform-graph'

describe('Operator-Node Synchronization', () => {
  beforeEach(() => {
    useGraphStore.getState().clearGraph()
  })

  // Helper: manually build operators from nodes (since subscribers are disabled)
  function buildOperators() {
    const store = useGraphStore.getState()
    transformGraph({ nodes: store.nodes, edges: store.edges })
  }

  describe('BEFORE refactor: Current behavior', () => {
    it('should have nodes and operators with duplicated state', () => {
      const store = useGraphStore.getState()

      // Add a node
      store.addNodes([
        {
          id: '/test',
          type: 'NumberOp',
          position: { x: 0, y: 0 },
          data: { inputs: { value: 42 } },
        },
      ])

      // Build operators from nodes (manual since subscribers disabled)
      buildOperators()

      // Currently: state is duplicated
      const node = store.nodes.find(n => n.id === '/test')
      const operator = store.getOp('/test')

      expect(node).toBeDefined()
      expect(node?.data?.inputs?.value).toBe(42)
      expect(operator?.inputs.value.value).toBe(42)

      // They're separate - changing one doesn't update the other
      operator!.inputs.value.setValue(100)
      const nodeAfter = store.nodes.find(n => n.id === '/test')
      expect(nodeAfter?.data?.inputs?.value).toBe(42) // Still old value!
      expect(operator!.inputs.value.value).toBe(100)
    })

    it('should handle node position updates', () => {
      const store = useGraphStore.getState()

      store.addNodes([
        {
          id: '/test',
          type: 'NumberOp',
          position: { x: 100, y: 200 },
          data: {},
        },
      ])

      // Update position via ReactFlow
      store.updateNode('/test', {
        position: { x: 300, y: 400 },
      })

      const node = store.nodes.find(n => n.id === '/test')
      expect(node?.position).toEqual({ x: 300, y: 400 })
    })

    it('should handle field value updates via updateNode', () => {
      const store = useGraphStore.getState()

      store.addNodes([
        {
          id: '/test',
          type: 'NumberOp',
          position: { x: 0, y: 0 },
          data: { inputs: { value: 10 } },
        },
      ])

      // Update value
      store.updateNode('/test', {
        data: { inputs: { value: 20 } },
      })

      const node = store.nodes.find(n => n.id === '/test')
      expect(node?.data.inputs.value).toBe(20)
    })

    it('should handle operator field setValue', () => {
      const store = useGraphStore.getState()

      // Add node first
      store.addNodes([
        {
          id: '/test',
          type: 'NumberOp',
          position: { x: 0, y: 0 },
          data: { inputs: { value: 10 } },
        },
      ])

      buildOperators()
      const op = store.getOp('/test')!

      // Set value directly on operator
      op.inputs.value.setValue(50)

      expect(op.inputs.value.value).toBe(50)
      expect(op.dirty).toBe(true) // markDirty was called
    })

    it('should handle multiple operators independently', () => {
      const store = useGraphStore.getState()

      const op1 = new NumberOp('/op1')
      const op2 = new NumberOp('/op2')

      op1.inputs.value.setValue(10)
      op2.inputs.value.setValue(20)

      store.setOp('/op1', op1)
      store.setOp('/op2', op2)

      expect(store.getOp('/op1')?.inputs.value.value).toBe(10)
      expect(store.getOp('/op2')?.inputs.value.value).toBe(20)
    })

    it('should handle node deletion', () => {
      const store = useGraphStore.getState()

      store.addNodes([
        { id: '/test1', type: 'NumberOp', position: { x: 0, y: 0 }, data: {} },
        { id: '/test2', type: 'NumberOp', position: { x: 0, y: 0 }, data: {} },
      ])

      store.deleteNodes(['/test1'])

      expect(store.nodes.length).toBe(1)
      expect(store.nodes[0].id).toBe('/test2')
    })

    it('should handle edge operations', () => {
      const store = useGraphStore.getState()

      store.addEdges([
        {
          id: 'e1',
          source: '/op1',
          target: '/op2',
          sourceHandle: 'out.value',
          targetHandle: 'par.value',
        },
      ])

      expect(store.edges.length).toBe(1)
      expect(store.edges[0].source).toBe('/op1')

      store.deleteEdges(['e1'])
      expect(store.edges.length).toBe(0)
    })
  })

  describe('AFTER refactor: Operators as source of truth', () => {
    it('should sync node when operator changes', () => {
      const store = useGraphStore.getState()

      // Add node (minimal data - no inputs duplication)
      store.addNodes([
        {
          id: '/test',
          type: 'NumberOp',
          position: { x: 0, y: 0 },
          data: undefined, // No duplicated state
        },
      ])

      // Build operator from node
      buildOperators()
      const op = store.getOp('/test')!

      // Set initial value
      op.inputs.value.setValue(42)

      // Change operator value
      op.inputs.value.setValue(100)

      // Manually sync (in real code, this would be automatic)
      store.syncNodeFromOperator('/test')

      // Operator has the new value
      expect(op.inputs.value.value).toBe(100)

      // Node still exists (visual state preserved)
      const node = store.nodes.find(n => n.id === '/test')
      expect(node).toBeDefined()
      expect(node?.id).toBe('/test')
    })

    it('should preserve node visual state when operator changes', () => {
      const store = useGraphStore.getState()

      store.addNodes([
        {
          id: '/test',
          type: 'NumberOp',
          position: { x: 100, y: 200 },
          selected: true,
          data: undefined,
        },
      ])

      buildOperators()
      const op = store.getOp('/test')!

      // Change operator
      op.inputs.value.setValue(50)
      store.syncNodeFromOperator('/test')

      // Visual state preserved
      const node = store.nodes.find(n => n.id === '/test')
      expect(node?.position).toEqual({ x: 100, y: 200 })
      expect(node?.selected).toBe(true)
    })

    it('should handle immutable node updates', () => {
      const store = useGraphStore.getState()

      store.addNodes([
        { id: '/test1', type: 'NumberOp', position: { x: 0, y: 0 }, data: undefined },
        { id: '/test2', type: 'NumberOp', position: { x: 0, y: 0 }, data: undefined },
      ])

      const oldNodesRef = store.nodes

      // Sync one node
      store.syncNodeFromOperator('/test1')

      // Should create new array (immutable)
      expect(store.nodes).not.toBe(oldNodesRef)
      // But still have same nodes
      expect(store.nodes.length).toBe(2)
    })

    it('should work with multiple operators changing', () => {
      const store = useGraphStore.getState()

      const op1 = new NumberOp('/op1')
      const op2 = new NumberOp('/op2')

      store.setOp('/op1', op1)
      store.setOp('/op2', op2)

      store.addNodes([
        { id: '/op1', type: 'NumberOp', position: { x: 0, y: 0 }, data: undefined },
        { id: '/op2', type: 'NumberOp', position: { x: 0, y: 0 }, data: undefined },
      ])

      // Change both
      op1.inputs.value.setValue(10)
      op2.inputs.value.setValue(20)

      store.syncNodeFromOperator('/op1')
      store.syncNodeFromOperator('/op2')

      // Operators have correct values
      expect(store.getOp('/op1')?.inputs.value.value).toBe(10)
      expect(store.getOp('/op2')?.inputs.value.value).toBe(20)

      // Nodes still exist
      expect(store.nodes.length).toBe(2)
    })

    it('should handle serialization from operators', () => {
      const store = useGraphStore.getState()

      const op = new NumberOp('/test')
      op.inputs.value.setValue(42)
      store.setOp('/test', op)

      store.addNodes([
        {
          id: '/test',
          type: 'NumberOp',
          position: { x: 100, y: 200 },
          data: undefined,
        },
      ])

      // When serializing, extract from operator
      const node = store.nodes[0]
      const operator = store.getOp(node.id)

      const serialized = {
        id: node.id,
        type: node.type,
        position: node.position,
        data: {
          inputs: {
            value: operator?.inputs.value.value,
          },
        },
      }

      expect(serialized.data.inputs.value).toBe(42)
      expect(serialized.position).toEqual({ x: 100, y: 200 })
    })

    it('should handle loading from JSON', () => {
      const store = useGraphStore.getState()

      const projectJSON = {
        nodes: [
          {
            id: '/test',
            type: 'NumberOp',
            position: { x: 50, y: 50 },
            data: { inputs: { value: 99 } },
          },
        ],
        edges: [],
      }

      // Load: create operator from JSON
      const op = new NumberOp(projectJSON.nodes[0].id)
      op.inputs.value.setValue(projectJSON.nodes[0].data.inputs.value)
      store.setOp(op.id, op)

      // Create node (without duplicating data)
      store.addNodes([
        {
          id: projectJSON.nodes[0].id,
          type: projectJSON.nodes[0].type,
          position: projectJSON.nodes[0].position,
          data: undefined,
        },
      ])

      // Operator has the data
      expect(store.getOp('/test')?.inputs.value.value).toBe(99)
      // Node has position
      expect(store.nodes[0].position).toEqual({ x: 50, y: 50 })
    })
  })

  describe('Edge cases', () => {
    it('should handle syncNodeFromOperator for non-existent node', () => {
      const store = useGraphStore.getState()

      // Should not throw
      expect(() => {
        store.syncNodeFromOperator('/nonexistent')
      }).not.toThrow()
    })

    it('should handle concurrent updates', () => {
      const store = useGraphStore.getState()

      store.addNodes([
        {
          id: '/test',
          type: 'NumberOp',
          position: { x: 0, y: 0 },
          data: { inputs: { value: 0 } },
        },
      ])

      buildOperators()
      const op = store.getOp('/test')!

      // Multiple rapid updates
      op.inputs.value.setValue(1)
      store.syncNodeFromOperator('/test')
      op.inputs.value.setValue(2)
      store.syncNodeFromOperator('/test')
      op.inputs.value.setValue(3)
      store.syncNodeFromOperator('/test')

      expect(op.inputs.value.value).toBe(3)
    })

    it('should preserve array immutability across operations', () => {
      const store = useGraphStore.getState()

      store.addNodes([{ id: '/test', type: 'NumberOp', position: { x: 0, y: 0 }, data: undefined }])
      buildOperators() // Need operator to exist for syncNodeFromOperator

      const refs: unknown[] = []
      refs.push(store.nodes)

      store.syncNodeFromOperator('/test')
      refs.push(store.nodes)

      store.updateNode('/test', { position: { x: 10, y: 10 } })
      refs.push(store.nodes)

      // All different references (immutable)
      expect(refs[0]).not.toBe(refs[1])
      expect(refs[1]).not.toBe(refs[2])
      expect(refs[0]).not.toBe(refs[2])
    })
  })
})
