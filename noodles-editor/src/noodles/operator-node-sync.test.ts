// Tests for operator-node synchronization
// These tests ensure that when we refactor to make operators the source of truth,
// all existing flows continue to work correctly.

import { beforeEach, describe, expect, it } from 'vitest'
import { useGraphStore } from './store'
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
          data: { inputs: { val: 42 } },
        },
      ])

      // Build operators from nodes (manual since subscribers disabled)
      buildOperators()

      // Get fresh store state after building operators
      const storeAfter = useGraphStore.getState()

      // Currently: state is duplicated
      const node = storeAfter.nodes.find(n => n.id === '/test')
      const operator = storeAfter.getOp('/test')

      expect(node).toBeDefined()
      expect(node?.data?.inputs?.val).toBe(42)
      expect(operator?.inputs.val.value).toBe(42)

      // They're separate - changing one doesn't update the other
      operator!.inputs.val.setValue(100)
      const storeAfterSet = useGraphStore.getState()
      const nodeAfterSet = storeAfterSet.nodes.find(n => n.id === '/test')
      expect(nodeAfterSet?.data?.inputs?.val).toBe(42) // Still old value!
      expect(operator!.inputs.val.value).toBe(100)
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

      // Get fresh state after update
      const storeAfter = useGraphStore.getState()
      const node = storeAfter.nodes.find(n => n.id === '/test')
      expect(node?.position).toEqual({ x: 300, y: 400 })
    })

    it('should handle field value updates via updateNode', () => {
      const store = useGraphStore.getState()

      store.addNodes([
        {
          id: '/test',
          type: 'NumberOp',
          position: { x: 0, y: 0 },
          data: { inputs: { val: 10 } },
        },
      ])

      // Update value
      store.updateNode('/test', {
        data: { inputs: { val: 20 } },
      })

      // Get fresh state after update
      const storeAfter = useGraphStore.getState()
      const node = storeAfter.nodes.find(n => n.id === '/test')
      expect(node?.data.inputs.val).toBe(20)
    })

    it('should handle operator field setValue', () => {
      const store = useGraphStore.getState()

      // Add node first
      store.addNodes([
        {
          id: '/test',
          type: 'NumberOp',
          position: { x: 0, y: 0 },
          data: { inputs: { val: 10 } },
        },
      ])

      buildOperators()
      const storeAfter = useGraphStore.getState()
      const op = storeAfter.getOp('/test')!

      // Set value directly on operator
      op.inputs.val.setValue(50)

      expect(op.inputs.val.value).toBe(50)
      expect(op.dirty).toBe(true) // markDirty was called
    })

    it('should handle multiple operators independently', () => {
      const store = useGraphStore.getState()

      store.addNodes([
        { id: '/op1', type: 'NumberOp', position: { x: 0, y: 0 }, data: { inputs: { val: 10 } } },
        { id: '/op2', type: 'NumberOp', position: { x: 0, y: 0 }, data: { inputs: { val: 20 } } },
      ])

      buildOperators()
      const storeAfter = useGraphStore.getState()

      expect(storeAfter.getOp('/op1')?.inputs.val.value).toBe(10)
      expect(storeAfter.getOp('/op2')?.inputs.val.value).toBe(20)
    })

    it('should handle node deletion', () => {
      const store = useGraphStore.getState()

      store.addNodes([
        { id: '/test1', type: 'NumberOp', position: { x: 0, y: 0 }, data: {} },
        { id: '/test2', type: 'NumberOp', position: { x: 0, y: 0 }, data: {} },
      ])

      store.deleteNodes(['/test1'])

      // Get fresh state after deletion
      const storeAfter = useGraphStore.getState()
      expect(storeAfter.nodes.length).toBe(1)
      expect(storeAfter.nodes[0].id).toBe('/test2')
    })

    it('should handle edge operations', () => {
      const store = useGraphStore.getState()

      store.addEdges([
        {
          id: 'e1',
          source: '/op1',
          target: '/op2',
          sourceHandle: 'out.val',
          targetHandle: 'par.val',
        },
      ])

      // Get fresh state after adding edges
      const storeAfterAdd = useGraphStore.getState()
      expect(storeAfterAdd.edges.length).toBe(1)
      expect(storeAfterAdd.edges[0].source).toBe('/op1')

      storeAfterAdd.deleteEdges(['e1'])

      // Get fresh state after deleting edges
      const storeAfterDelete = useGraphStore.getState()
      expect(storeAfterDelete.edges.length).toBe(0)
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
      const storeAfter = useGraphStore.getState()
      const op = storeAfter.getOp('/test')!

      // Set initial value
      op.inputs.val.setValue(42)

      // Change operator value
      op.inputs.val.setValue(100)

      // Manually sync (in real code, this would be automatic)
      storeAfter.syncNodeFromOperator('/test')

      // Operator has the new value
      expect(op.inputs.val.value).toBe(100)

      // Node still exists (visual state preserved)
      const storeAfterSync = useGraphStore.getState()
      const node = storeAfterSync.nodes.find(n => n.id === '/test')
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
      const storeAfter = useGraphStore.getState()
      const op = storeAfter.getOp('/test')!

      // Change operator
      op.inputs.val.setValue(50)
      storeAfter.syncNodeFromOperator('/test')

      // Visual state preserved
      const storeAfterSync = useGraphStore.getState()
      const node = storeAfterSync.nodes.find(n => n.id === '/test')
      expect(node?.position).toEqual({ x: 100, y: 200 })
      expect(node?.selected).toBe(true)
    })

    it('should handle immutable node updates', () => {
      const store = useGraphStore.getState()

      store.addNodes([
        {
          id: '/test1',
          type: 'NumberOp',
          position: { x: 0, y: 0 },
          data: { inputs: { val: 1 } },
        },
        {
          id: '/test2',
          type: 'NumberOp',
          position: { x: 0, y: 0 },
          data: { inputs: { val: 2 } },
        },
      ])

      buildOperators()

      const storeAfter = useGraphStore.getState()
      const oldNodesRef = storeAfter.nodes

      // Sync one node
      storeAfter.syncNodeFromOperator('/test1')

      // Should create new array (immutable)
      const storeAfterSync = useGraphStore.getState()
      expect(storeAfterSync.nodes).not.toBe(oldNodesRef)
      // But still have same nodes
      expect(storeAfterSync.nodes.length).toBe(2)
    })

    it('should work with multiple operators changing', () => {
      const store = useGraphStore.getState()

      store.addNodes([
        { id: '/op1', type: 'NumberOp', position: { x: 0, y: 0 }, data: { inputs: { val: 0 } } },
        { id: '/op2', type: 'NumberOp', position: { x: 0, y: 0 }, data: { inputs: { val: 0 } } },
      ])

      buildOperators()

      const storeAfter = useGraphStore.getState()
      const op1 = storeAfter.getOp('/op1')!
      const op2 = storeAfter.getOp('/op2')!

      // Change both
      op1.inputs.val.setValue(10)
      op2.inputs.val.setValue(20)

      storeAfter.syncNodeFromOperator('/op1')
      storeAfter.syncNodeFromOperator('/op2')

      // Operators have correct values
      const storeAfterSync = useGraphStore.getState()
      expect(storeAfterSync.getOp('/op1')?.inputs.val.value).toBe(10)
      expect(storeAfterSync.getOp('/op2')?.inputs.val.value).toBe(20)

      // Nodes still exist
      expect(storeAfterSync.nodes.length).toBe(2)
    })

    it('should handle serialization from operators', () => {
      const store = useGraphStore.getState()

      store.addNodes([
        {
          id: '/test',
          type: 'NumberOp',
          position: { x: 100, y: 200 },
          data: { inputs: { val: 42 } },
        },
      ])

      buildOperators()

      // When serializing, extract from operator (not from node.data)
      const storeAfter = useGraphStore.getState()
      const node = storeAfter.nodes.find(n => n.id === '/test')!
      const operator = storeAfter.getOp(node.id)

      const serialized = {
        id: node.id,
        type: node.type,
        position: node.position,
        data: {
          inputs: {
            val: operator?.inputs.val.value,
          },
        },
      }

      expect(serialized.data.inputs.val).toBe(42)
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
            data: { inputs: { val: 99 } },
          },
        ],
        edges: [],
      }

      // Load: create operator from JSON
      const op = new NumberOp(projectJSON.nodes[0].id)
      op.inputs.val.setValue(projectJSON.nodes[0].data.inputs.val)
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

      // Get fresh state
      const storeAfter = useGraphStore.getState()
      // Operator has the data
      expect(storeAfter.getOp('/test')?.inputs.val.value).toBe(99)
      // Node has position
      expect(storeAfter.nodes[0].position).toEqual({ x: 50, y: 50 })
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
          data: { inputs: { val: 0 } },
        },
      ])

      buildOperators()
      const storeAfter = useGraphStore.getState()
      const op = storeAfter.getOp('/test')!

      // Multiple rapid updates
      op.inputs.val.setValue(1)
      storeAfter.syncNodeFromOperator('/test')
      op.inputs.val.setValue(2)
      storeAfter.syncNodeFromOperator('/test')
      op.inputs.val.setValue(3)
      storeAfter.syncNodeFromOperator('/test')

      expect(op.inputs.val.value).toBe(3)
    })

    it('should preserve array immutability across operations', () => {
      const store = useGraphStore.getState()

      store.addNodes([{ id: '/test', type: 'NumberOp', position: { x: 0, y: 0 }, data: undefined }])
      buildOperators() // Need operator to exist for syncNodeFromOperator

      const refs: unknown[] = []
      const store1 = useGraphStore.getState()
      refs.push(store1.nodes)

      store1.syncNodeFromOperator('/test')
      const store2 = useGraphStore.getState()
      refs.push(store2.nodes)

      store2.updateNode('/test', { position: { x: 10, y: 10 } })
      const store3 = useGraphStore.getState()
      refs.push(store3.nodes)

      // All different references (immutable)
      expect(refs[0]).not.toBe(refs[1])
      expect(refs[1]).not.toBe(refs[2])
      expect(refs[0]).not.toBe(refs[2])
    })
  })
})
