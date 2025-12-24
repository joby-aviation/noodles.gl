// Integration tests for useProjectModifications hook
// Tests node and edge manipulation operations

import { act, renderHook } from '@testing-library/react'
import type { Edge as ReactFlowEdge, Node as ReactFlowNode } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NumberOp } from '../../operators'
import { clearOps, setOp } from '../../store'
import { type ProjectModification, useProjectModifications } from '../use-project-modifications'

describe('useProjectModifications', () => {
  // State management for React Flow
  let nodes: ReactFlowNode[] = []
  let edges: ReactFlowEdge[] = []

  const getNodes = () => nodes
  const getEdges = () => edges
  const setNodes = (update: ReactFlowNode[] | ((nodes: ReactFlowNode[]) => ReactFlowNode[])) => {
    nodes = typeof update === 'function' ? update(nodes) : update
  }
  const setEdges = (update: ReactFlowEdge[] | ((edges: ReactFlowEdge[]) => ReactFlowEdge[])) => {
    edges = typeof update === 'function' ? update(edges) : update
  }

  beforeEach(() => {
    nodes = []
    edges = []
    clearOps()
  })

  afterEach(() => {
    clearOps()
  })

  describe('addNode', () => {
    it('should add a single node', () => {
      const { result } = renderHook(() =>
        useProjectModifications({ getNodes, getEdges, setNodes, setEdges })
      )

      const newNode: ReactFlowNode = {
        id: '/test-node',
        type: 'NumberOp',
        position: { x: 0, y: 0 },
        data: {},
      }

      act(() => {
        result.current.addNode(newNode)
      })

      expect(nodes).toHaveLength(1)
      expect(nodes[0]).toEqual(newNode)
    })

    it('should add multiple nodes sequentially', () => {
      const { result } = renderHook(() =>
        useProjectModifications({ getNodes, getEdges, setNodes, setEdges })
      )

      act(() => {
        result.current.addNode({
          id: '/node-1',
          type: 'NumberOp',
          position: { x: 0, y: 0 },
          data: {},
        })
        result.current.addNode({
          id: '/node-2',
          type: 'NumberOp',
          position: { x: 100, y: 0 },
          data: {},
        })
      })

      expect(nodes).toHaveLength(2)
      expect(nodes[0].id).toBe('/node-1')
      expect(nodes[1].id).toBe('/node-2')
    })
  })

  describe('updateNode', () => {
    it('should update node position', () => {
      const { result } = renderHook(() =>
        useProjectModifications({ getNodes, getEdges, setNodes, setEdges })
      )

      const node: ReactFlowNode = {
        id: '/test-node',
        type: 'NumberOp',
        position: { x: 0, y: 0 },
        data: {},
      }

      act(() => {
        result.current.addNode(node)
      })

      act(() => {
        const updateResult = result.current.updateNode('/test-node', {
          position: { x: 100, y: 200 },
        })
        expect(updateResult.success).toBe(true)
      })

      expect(nodes[0].position).toEqual({ x: 100, y: 200 })
    })

    it('should update node inputs and sync with operator', () => {
      const op = new NumberOp('/test-node', { val: 10 })
      setOp('/test-node', op)

      const { result } = renderHook(() =>
        useProjectModifications({ getNodes, getEdges, setNodes, setEdges })
      )

      const node: ReactFlowNode = {
        id: '/test-node',
        type: 'NumberOp',
        position: { x: 0, y: 0 },
        data: { inputs: { val: 10 } },
      }

      act(() => {
        result.current.addNode(node)
      })

      act(() => {
        const updateResult = result.current.updateNode('/test-node', {
          data: { inputs: { val: 42 } },
        })
        expect(updateResult.success).toBe(true)
      })

      // Check that both the node data and the operator were updated
      expect(nodes[0].data.inputs.val).toBe(42)
      expect(op.inputs.val.value).toBe(42)
    })

    it('should return error when updating non-existent node', () => {
      const { result } = renderHook(() =>
        useProjectModifications({ getNodes, getEdges, setNodes, setEdges })
      )

      act(() => {
        const updateResult = result.current.updateNode('/nonexistent', {
          position: { x: 100, y: 100 },
        })
        expect(updateResult.success).toBe(false)
        expect(updateResult.error).toContain('not found')
      })
    })
  })

  describe('deleteNodes', () => {
    it('should delete a single node', () => {
      const { result } = renderHook(() =>
        useProjectModifications({ getNodes, getEdges, setNodes, setEdges })
      )

      act(() => {
        result.current.addNode({
          id: '/test-node',
          type: 'NumberOp',
          position: { x: 0, y: 0 },
          data: {},
        })
      })

      expect(nodes).toHaveLength(1)

      act(() => {
        const deleteResult = result.current.deleteNodes(['/test-node'])
        expect(deleteResult.success).toBe(true)
      })

      expect(nodes).toHaveLength(0)
    })

    it('should return error when deleting non-existent node', () => {
      const { result } = renderHook(() =>
        useProjectModifications({ getNodes, getEdges, setNodes, setEdges })
      )

      act(() => {
        const deleteResult = result.current.deleteNodes(['/nonexistent'])
        expect(deleteResult.success).toBe(false)
        expect(deleteResult.error).toContain('No nodes found')
      })
    })

    it('should reconnect edges when deleting intermediate node', () => {
      // Create three operators
      const op1 = new NumberOp('/node-1', { val: 1 })
      const op2 = new NumberOp('/node-2', { val: 2 })
      const op3 = new NumberOp('/node-3', { val: 3 })
      setOp('/node-1', op1)
      setOp('/node-2', op2)
      setOp('/node-3', op3)

      const { result } = renderHook(() =>
        useProjectModifications({ getNodes, getEdges, setNodes, setEdges })
      )

      // Add three nodes in a chain
      act(() => {
        result.current.addNode({
          id: '/node-1',
          type: 'NumberOp',
          position: { x: 0, y: 0 },
          data: {},
        })
        result.current.addNode({
          id: '/node-2',
          type: 'NumberOp',
          position: { x: 100, y: 0 },
          data: {},
        })
        result.current.addNode({
          id: '/node-3',
          type: 'NumberOp',
          position: { x: 200, y: 0 },
          data: {},
        })
      })

      // Add edges: node-1 -> node-2 -> node-3
      const sourceHandle = 'out.val'
      const targetHandle1 = 'par.val'
      const targetHandle2 = 'par.val'

      act(() => {
        setEdges([
          {
            id: 'edge-1',
            source: '/node-1',
            target: '/node-2',
            sourceHandle,
            targetHandle: targetHandle1,
          },
          {
            id: 'edge-2',
            source: '/node-2',
            target: '/node-3',
            sourceHandle,
            targetHandle: targetHandle2,
          },
        ])
      })

      expect(edges).toHaveLength(2)

      // Delete the middle node
      act(() => {
        const deleteResult = result.current.deleteNodes(['/node-2'])
        expect(deleteResult.success).toBe(true)
        expect(deleteResult.warnings).toBeDefined()
      })

      expect(nodes).toHaveLength(2)
      // Should have reconnected node-1 -> node-3
      expect(edges.length).toBeGreaterThan(0)
      expect(edges.some(e => e.source === '/node-1' && e.target === '/node-3')).toBe(true)
    })
  })

  describe('addEdge', () => {
    beforeEach(() => {
      // Set up two connected operators
      const op1 = new NumberOp('/source', { val: 42 })
      const op2 = new NumberOp('/target', { val: 0 })
      setOp('/source', op1)
      setOp('/target', op2)

      nodes = [
        {
          id: '/source',
          type: 'NumberOp',
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: '/target',
          type: 'NumberOp',
          position: { x: 100, y: 0 },
          data: {},
        },
      ]
    })

    it('should add a valid edge', () => {
      const { result } = renderHook(() =>
        useProjectModifications({ getNodes, getEdges, setNodes, setEdges })
      )

      const edge: ReactFlowEdge = {
        id: 'test-edge',
        source: '/source',
        target: '/target',
        sourceHandle: 'out.val',
        targetHandle: 'par.val',
      }

      act(() => {
        const addResult = result.current.addEdge(edge)
        expect(addResult.success).toBe(true)
      })

      expect(edges).toHaveLength(1)
      expect(edges[0]).toEqual(edge)
    })

    it('should reject edge with non-existent source node', () => {
      const { result } = renderHook(() =>
        useProjectModifications({ getNodes, getEdges, setNodes, setEdges })
      )

      const edge: ReactFlowEdge = {
        id: 'test-edge',
        source: '/nonexistent',
        target: '/target',
        sourceHandle: 'out.val',
        targetHandle: 'par.val',
      }

      act(() => {
        const addResult = result.current.addEdge(edge)
        expect(addResult.success).toBe(false)
        expect(addResult.error).toContain('node not found')
      })

      expect(edges).toHaveLength(0)
    })

    it('should reject edge with non-existent target node', () => {
      const { result } = renderHook(() =>
        useProjectModifications({ getNodes, getEdges, setNodes, setEdges })
      )

      const edge: ReactFlowEdge = {
        id: 'test-edge',
        source: '/source',
        target: '/nonexistent',
        sourceHandle: 'out.val',
        targetHandle: 'par.val',
      }

      act(() => {
        const addResult = result.current.addEdge(edge)
        expect(addResult.success).toBe(false)
        expect(addResult.error).toContain('node not found')
      })

      expect(edges).toHaveLength(0)
    })
  })

  describe('deleteEdge', () => {
    it('should delete an edge', () => {
      const { result } = renderHook(() =>
        useProjectModifications({ getNodes, getEdges, setNodes, setEdges })
      )

      act(() => {
        setEdges([
          {
            id: 'edge-1',
            source: '/node-1',
            target: '/node-2',
            sourceHandle: 'out.result',
            targetHandle: 'par.val',
          },
        ])
      })

      expect(edges).toHaveLength(1)

      act(() => {
        result.current.deleteEdge('edge-1')
      })

      expect(edges).toHaveLength(0)
    })
  })

  describe('applyModifications - batch operations', () => {
    it('should apply multiple node additions atomically', () => {
      const { result } = renderHook(() =>
        useProjectModifications({ getNodes, getEdges, setNodes, setEdges })
      )

      const modifications: ProjectModification[] = [
        {
          type: 'add_node',
          data: {
            id: '/node-1',
            type: 'NumberOp',
            position: { x: 0, y: 0 },
            data: {},
          },
        },
        {
          type: 'add_node',
          data: {
            id: '/node-2',
            type: 'NumberOp',
            position: { x: 100, y: 0 },
            data: {},
          },
        },
      ]

      act(() => {
        const applyResult = result.current.applyModifications(modifications)
        expect(applyResult.success).toBe(true)
      })

      expect(nodes).toHaveLength(2)
    })

    it('should add nodes and edges together', () => {
      // Set up operators
      const op1 = new NumberOp('/node-1', { val: 1 })
      const op2 = new NumberOp('/node-2', { val: 2 })
      setOp('/node-1', op1)
      setOp('/node-2', op2)

      const { result } = renderHook(() =>
        useProjectModifications({ getNodes, getEdges, setNodes, setEdges })
      )

      const modifications: ProjectModification[] = [
        {
          type: 'add_node',
          data: {
            id: '/node-1',
            type: 'NumberOp',
            position: { x: 0, y: 0 },
            data: {},
          },
        },
        {
          type: 'add_node',
          data: {
            id: '/node-2',
            type: 'NumberOp',
            position: { x: 100, y: 0 },
            data: {},
          },
        },
        {
          type: 'add_edge',
          data: {
            id: 'edge-1',
            source: '/node-1',
            target: '/node-2',
            sourceHandle: 'out.val',
            targetHandle: 'par.val',
          },
        },
      ]

      act(() => {
        const applyResult = result.current.applyModifications(modifications)
        expect(applyResult.success).toBe(true)
      })

      expect(nodes).toHaveLength(2)
      expect(edges).toHaveLength(1)
      expect(edges[0].source).toBe('/node-1')
      expect(edges[0].target).toBe('/node-2')
    })

    it('should handle mixed operations (add, update, delete)', () => {
      const op1 = new NumberOp('/node-1', { val: 1 })
      const op2 = new NumberOp('/node-2', { val: 2 })
      setOp('/node-1', op1)
      setOp('/node-2', op2)

      const { result } = renderHook(() =>
        useProjectModifications({ getNodes, getEdges, setNodes, setEdges })
      )

      // Start with two nodes
      act(() => {
        result.current.addNode({
          id: '/node-1',
          type: 'NumberOp',
          position: { x: 0, y: 0 },
          data: { inputs: { val: 1 } },
        })
        result.current.addNode({
          id: '/node-2',
          type: 'NumberOp',
          position: { x: 100, y: 0 },
          data: { inputs: { val: 2 } },
        })
      })

      const modifications: ProjectModification[] = [
        {
          type: 'update_node',
          data: {
            id: '/node-1',
            data: { inputs: { val: 42 } },
          },
        },
        {
          type: 'add_node',
          data: {
            id: '/node-3',
            type: 'NumberOp',
            position: { x: 200, y: 0 },
            data: {},
          },
        },
        {
          type: 'delete_node',
          data: { id: '/node-2' },
        },
      ]

      let applyResult: { success: boolean; error?: string; warnings?: string[] } = {
        success: false,
      }
      act(() => {
        applyResult = result.current.applyModifications(modifications)
      })

      expect(applyResult.success).toBe(true)

      expect(nodes).toHaveLength(2) // node-1 (updated) and node-3 (new)
      expect(nodes.find(n => n.id === '/node-1')?.data.inputs.val).toBe(42)
      expect(nodes.find(n => n.id === '/node-3')).toBeDefined()
      expect(nodes.find(n => n.id === '/node-2')).toBeUndefined()
    })

    it('should skip edges with missing nodes but continue with valid edges', () => {
      const op1 = new NumberOp('/node-1', { val: 1 })
      setOp('/node-1', op1)

      const { result } = renderHook(() =>
        useProjectModifications({ getNodes, getEdges, setNodes, setEdges })
      )

      const modifications: ProjectModification[] = [
        {
          type: 'add_node',
          data: {
            id: '/node-1',
            type: 'NumberOp',
            position: { x: 0, y: 0 },
            data: {},
          },
        },
        // This edge references a non-existent node
        {
          type: 'add_edge',
          data: {
            id: 'invalid-edge',
            source: '/node-1',
            target: '/nonexistent',
            sourceHandle: 'out.val',
            targetHandle: 'par.val',
          },
        },
      ]

      act(() => {
        const applyResult = result.current.applyModifications(modifications)
        expect(applyResult.success).toBe(true)
        expect(applyResult.warnings).toBeDefined()
        expect(applyResult.warnings?.[0]).toContain('skipped')
      })

      expect(nodes).toHaveLength(1)
      expect(edges).toHaveLength(0) // Edge should be skipped
    })
  })

  describe('ReactFlow callbacks', () => {
    it('onNodesDelete should handle edge reconnection after node deletion', () => {
      // Create three operators
      const op1 = new NumberOp('/node-1', { val: 1 })
      const op2 = new NumberOp('/node-2', { val: 2 })
      const op3 = new NumberOp('/node-3', { val: 3 })
      setOp('/node-1', op1)
      setOp('/node-2', op2)
      setOp('/node-3', op3)

      const { result } = renderHook(() =>
        useProjectModifications({ getNodes, getEdges, setNodes, setEdges })
      )

      // Add three nodes
      act(() => {
        result.current.addNode({
          id: '/node-1',
          type: 'NumberOp',
          position: { x: 0, y: 0 },
          data: {},
        })
        result.current.addNode({
          id: '/node-2',
          type: 'NumberOp',
          position: { x: 100, y: 0 },
          data: {},
        })
        result.current.addNode({
          id: '/node-3',
          type: 'NumberOp',
          position: { x: 200, y: 0 },
          data: {},
        })
      })

      // Add edges: node-1 -> node-2 -> node-3
      const sourceHandle = 'out.val'
      const targetHandle = 'par.val'

      act(() => {
        setEdges([
          {
            id: 'edge-1',
            source: '/node-1',
            target: '/node-2',
            sourceHandle,
            targetHandle,
          },
          {
            id: 'edge-2',
            source: '/node-2',
            target: '/node-3',
            sourceHandle,
            targetHandle,
          },
        ])
      })

      expect(edges).toHaveLength(2)

      // Simulate ReactFlow deleting node-2 (ReactFlow removes it from nodes array)
      act(() => {
        setNodes(currentNodes => currentNodes.filter(n => n.id !== '/node-2'))
      })

      // Call onNodesDelete to handle edge reconnection
      act(() => {
        result.current.onNodesDelete([
          {
            id: '/node-2',
            type: 'NumberOp',
            position: { x: 100, y: 0 },
            data: {},
          },
        ])
      })

      expect(nodes).toHaveLength(2) // node-2 was removed
      // Should have reconnected node-1 -> node-3
      expect(edges.some(e => e.source === '/node-1' && e.target === '/node-3')).toBe(true)
    })

    it('onConnect should add edge with validation', () => {
      const op1 = new NumberOp('/source', { val: 42 })
      const op2 = new NumberOp('/target', { val: 0 })
      setOp('/source', op1)
      setOp('/target', op2)

      const { result } = renderHook(() =>
        useProjectModifications({ getNodes, getEdges, setNodes, setEdges })
      )

      act(() => {
        result.current.addNode({
          id: '/source',
          type: 'NumberOp',
          position: { x: 0, y: 0 },
          data: {},
        })
        result.current.addNode({
          id: '/target',
          type: 'NumberOp',
          position: { x: 100, y: 0 },
          data: {},
        })
      })

      act(() => {
        result.current.onConnect({
          source: '/source',
          target: '/target',
          sourceHandle: 'out.val',
          targetHandle: 'par.val',
        })
      })

      expect(edges).toHaveLength(1)
      expect(edges[0].source).toBe('/source')
      expect(edges[0].target).toBe('/target')
    })
  })
})
