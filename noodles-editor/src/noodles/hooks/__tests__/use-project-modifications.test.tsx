// Integration tests for useProjectModifications hook
// Tests node and edge manipulation operations

import { act, renderHook } from '@testing-library/react'
import type { Edge as ReactFlowEdge, Node as ReactFlowNode } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConcatOp, DeckRendererOp, MapViewStateOp, NumberOp, PointOp } from '../../operators'
import { clearOps, setOp, setPendingInsertionIndex } from '../../store'
import { MULTI_INPUT_EDGE_TYPE } from '../../utils/multi-input-utils'
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

    it('should auto-show hidden field when setting value programmatically', () => {
      // DeckRendererOp has 'effects' field with showByDefault: false
      const op = new DeckRendererOp('/deck')
      setOp('/deck', op)

      // Verify effects is hidden by default
      expect(op.inputs.effects.showByDefault).toBe(false)
      expect(op.isFieldVisible('effects')).toBe(false)

      const node: ReactFlowNode = {
        id: '/deck',
        type: 'DeckRendererOp',
        position: { x: 0, y: 0 },
        data: {},
      }

      nodes = [node]

      const { result } = renderHook(() =>
        useProjectModifications({ getNodes, getEdges, setNodes, setEdges })
      )

      // Update the hidden 'effects' field programmatically
      act(() => {
        result.current.updateNode('/deck', {
          data: {
            inputs: {
              effects: [{ type: 'lighting' }],
            },
          },
        })
      })

      // Field should now be visible after programmatic update
      expect(op.isFieldVisible('effects')).toBe(true)
      expect(op.visibleFields.value).toBeInstanceOf(Set)
      expect(op.visibleFields.value?.has('effects')).toBe(true)
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

    it('switches a vector input to channel mode for a programmatic channel edge', () => {
      const map = new MapViewStateOp('/target')
      setOp('/target', map)
      nodes[1] = {
        id: '/target',
        type: 'MapViewStateOp',
        position: { x: 100, y: 0 },
        data: {},
      }
      const { result } = renderHook(() =>
        useProjectModifications({ getNodes, getEdges, setNodes, setEdges })
      )

      act(() => {
        const addResult = result.current.addEdge({
          id: 'channel-edge',
          source: '/source',
          target: '/target',
          sourceHandle: 'out.val',
          targetHandle: 'par.center.lng',
        })
        expect(addResult.success).toBe(true)
      })

      expect(map.getInputPortMode('center')).toBe('channels')
      expect(edges).toHaveLength(1)
    })

    it('rejects a whole vector edge while a channel edge is connected', () => {
      const map = new MapViewStateOp('/target', undefined, false, undefined, {
        center: 'channels',
      })
      const point = new PointOp('/point')
      setOp('/target', map)
      setOp('/point', point)
      nodes = [
        nodes[0],
        {
          id: '/point',
          type: 'PointOp',
          position: { x: 0, y: 100 },
          data: {},
        },
        {
          id: '/target',
          type: 'MapViewStateOp',
          position: { x: 100, y: 0 },
          data: {},
        },
      ]
      edges = [
        {
          id: 'channel-edge',
          source: '/source',
          target: '/target',
          sourceHandle: 'out.val',
          targetHandle: 'par.center.lng',
        },
      ]
      const { result } = renderHook(() =>
        useProjectModifications({ getNodes, getEdges, setNodes, setEdges })
      )
      let addResult: { success: boolean; error?: string } = { success: false }

      act(() => {
        addResult = result.current.addEdge({
          id: 'whole-edge',
          source: '/point',
          target: '/target',
          sourceHandle: 'out.feature',
          targetHandle: 'par.center',
        })
      })

      expect(addResult.success).toBe(false)
      expect(addResult.error).toContain('Disconnect center')
      expect(edges).toHaveLength(1)
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

    it('onConnect should not create an edge when source and target are the same node', () => {
      const op = new NumberOp('/self', { val: 42 })
      setOp('/self', op)

      const { result } = renderHook(() =>
        useProjectModifications({ getNodes, getEdges, setNodes, setEdges })
      )

      act(() => {
        result.current.addNode({
          id: '/self',
          type: 'NumberOp',
          position: { x: 0, y: 0 },
          data: {},
        })
      })

      act(() => {
        result.current.onConnect({
          source: '/self',
          target: '/self',
          sourceHandle: 'out.val',
          targetHandle: 'par.val',
        })
      })

      expect(edges).toHaveLength(0)
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

  describe('edge replacement with reconnectEdge', () => {
    it('should replace existing edge when connecting to non-ListField input', () => {
      const op1 = new NumberOp('/source-1', { val: 1 })
      const op2 = new NumberOp('/source-2', { val: 2 })
      const op3 = new NumberOp('/target', { val: 0 })
      setOp('/source-1', op1)
      setOp('/source-2', op2)
      setOp('/target', op3)

      const { result } = renderHook(() =>
        useProjectModifications({ getNodes, getEdges, setNodes, setEdges })
      )

      act(() => {
        result.current.addNode({
          id: '/source-1',
          type: 'NumberOp',
          position: { x: 0, y: 0 },
          data: {},
        })
        result.current.addNode({
          id: '/source-2',
          type: 'NumberOp',
          position: { x: 0, y: 100 },
          data: {},
        })
        result.current.addNode({
          id: '/target',
          type: 'NumberOp',
          position: { x: 200, y: 50 },
          data: {},
        })
      })

      // Create first connection
      act(() => {
        result.current.onConnect({
          source: '/source-1',
          target: '/target',
          sourceHandle: 'out.val',
          targetHandle: 'par.val',
        })
      })

      expect(edges).toHaveLength(1)
      expect(edges[0].source).toBe('/source-1')
      expect(edges[0].target).toBe('/target')
      const firstEdgeId = edges[0].id

      // Create second connection to same input - should replace first
      act(() => {
        result.current.onConnect({
          source: '/source-2',
          target: '/target',
          sourceHandle: 'out.val',
          targetHandle: 'par.val',
        })
      })

      // Should still have only 1 edge (replaced)
      expect(edges).toHaveLength(1)
      expect(edges[0].source).toBe('/source-2')
      expect(edges[0].target).toBe('/target')
      expect(edges[0].id).not.toBe(firstEdgeId)
    })

    it('should use reconnectEdge atomically without intermediate state', () => {
      const op1 = new NumberOp('/source-1', { val: 1 })
      const op2 = new NumberOp('/source-2', { val: 2 })
      const op3 = new NumberOp('/target', { val: 0 })
      setOp('/source-1', op1)
      setOp('/source-2', op2)
      setOp('/target', op3)

      // Track edge lengths to verify atomic updates
      const edgeLengthsHistory: number[] = []

      const { result } = renderHook(() =>
        useProjectModifications({
          getNodes,
          getEdges,
          setNodes,
          setEdges: (update: ReactFlowEdge[] | ((edges: ReactFlowEdge[]) => ReactFlowEdge[])) => {
            const newEdges = typeof update === 'function' ? update(edges) : update
            edgeLengthsHistory.push(newEdges.length)
            setEdges(newEdges)
          },
        })
      )

      act(() => {
        result.current.addNode({
          id: '/source-1',
          type: 'NumberOp',
          position: { x: 0, y: 0 },
          data: {},
        })
        result.current.addNode({
          id: '/source-2',
          type: 'NumberOp',
          position: { x: 0, y: 100 },
          data: {},
        })
        result.current.addNode({
          id: '/target',
          type: 'NumberOp',
          position: { x: 200, y: 50 },
          data: {},
        })
      })

      // Create first connection
      act(() => {
        result.current.onConnect({
          source: '/source-1',
          target: '/target',
          sourceHandle: 'out.val',
          targetHandle: 'par.val',
        })
      })

      expect(edges).toHaveLength(1)

      // Create second connection - should be atomic (single state update, no intermediate 0 or 2 edges)
      act(() => {
        result.current.onConnect({
          source: '/source-2',
          target: '/target',
          sourceHandle: 'out.val',
          targetHandle: 'par.val',
        })
      })

      // Verify atomic update - should never have 0 or 2 edges during replacement
      expect(edgeLengthsHistory).not.toContain(0)
      expect(edgeLengthsHistory).not.toContain(2)
      expect(edges).toHaveLength(1)
      expect(edges[0].source).toBe('/source-2')
    })

    it('should preserve edge metadata during reconnectEdge', () => {
      const op1 = new NumberOp('/source-1', { val: 1 })
      const op2 = new NumberOp('/source-2', { val: 2 })
      const op3 = new NumberOp('/target', { val: 0 })
      setOp('/source-1', op1)
      setOp('/source-2', op2)
      setOp('/target', op3)

      const { result } = renderHook(() =>
        useProjectModifications({ getNodes, getEdges, setNodes, setEdges })
      )

      act(() => {
        result.current.addNode({
          id: '/source-1',
          type: 'NumberOp',
          position: { x: 0, y: 0 },
          data: {},
        })
        result.current.addNode({
          id: '/source-2',
          type: 'NumberOp',
          position: { x: 0, y: 100 },
          data: {},
        })
        result.current.addNode({
          id: '/target',
          type: 'NumberOp',
          position: { x: 200, y: 50 },
          data: {},
        })
      })

      // Create first connection
      act(() => {
        result.current.onConnect({
          source: '/source-1',
          target: '/target',
          sourceHandle: 'out.val',
          targetHandle: 'par.val',
        })
      })

      const originalTargetHandle = edges[0].targetHandle

      // Replace connection
      act(() => {
        result.current.onConnect({
          source: '/source-2',
          target: '/target',
          sourceHandle: 'out.val',
          targetHandle: 'par.val',
        })
      })

      // Verify metadata preserved
      expect(edges[0].targetHandle).toBe(originalTargetHandle)
      expect(edges[0].target).toBe('/target')
    })
  })
  describe('multi-input (ListField) connections', () => {
    const numberSource = (id: string, val: number) => {
      setOp(id, new NumberOp(id, { val }))
      nodes.push({ id, type: 'NumberOp', position: { x: 0, y: 0 }, data: {} })
    }

    const listConnection = (source: string) => ({
      source,
      target: '/concat',
      sourceHandle: 'out.val',
      targetHandle: 'par.values',
    })

    const listEdgeId = (source: string) => `${source}.out.val->/concat.par.values`

    const groupIds = () =>
      edges.filter(e => e.target === '/concat' && e.targetHandle === 'par.values').map(e => e.id)

    const fieldOrder = (concat: ConcatOp) => Array.from(concat.inputs.values.fields.keys())

    let concat: ConcatOp

    beforeEach(() => {
      concat = new ConcatOp('/concat')
      setOp('/concat', concat)
      nodes.push({ id: '/concat', type: 'ConcatOp', position: { x: 0, y: 0 }, data: {} })
      numberSource('/a', 1)
      numberSource('/b', 2)
      numberSource('/c', 3)
      setPendingInsertionIndex(null)
    })

    const setup = () =>
      renderHook(() => useProjectModifications({ getNodes, getEdges, setNodes, setEdges })).result

    it('onConnect appends to the end and normalizes edge data', () => {
      const result = setup()

      act(() => {
        result.current.onConnect(listConnection('/a'))
        result.current.onConnect(listConnection('/b'))
      })

      expect(groupIds()).toEqual([listEdgeId('/a'), listEdgeId('/b')])
      expect(edges.map(e => e.type)).toEqual([MULTI_INPUT_EDGE_TYPE, MULTI_INPUT_EDGE_TYPE])
      expect(edges.map(e => e.data?.orderIndex)).toEqual([0, 1])
      expect(edges.map(e => e.data?.groupSize)).toEqual([2, 2])
      expect(fieldOrder(concat)).toEqual([listEdgeId('/a'), listEdgeId('/b')])
    })

    it('onConnect inserts at the slot tracked during the drag', () => {
      const result = setup()

      act(() => {
        result.current.onConnect(listConnection('/a'))
        result.current.onConnect(listConnection('/b'))
      })

      // MultiInputHandle tracked the pointer between slots 0 and 1 during the drag
      act(() => {
        setPendingInsertionIndex({ nodeId: '/concat', handleId: 'par.values', index: 1 })
        result.current.onConnect(listConnection('/c'))
      })

      expect(groupIds()).toEqual([listEdgeId('/a'), listEdgeId('/c'), listEdgeId('/b')])
      expect(edges.map(e => e.data?.orderIndex)).toEqual([0, 1, 2])
      // The actual data order the operator receives must match the visual slot order
      expect(fieldOrder(concat)).toEqual([listEdgeId('/a'), listEdgeId('/c'), listEdgeId('/b')])
    })

    it('onConnect ignores a pending index left over from a different handle', () => {
      const result = setup()

      act(() => {
        setPendingInsertionIndex({ nodeId: '/other', handleId: 'par.values', index: 0 })
        result.current.onConnect(listConnection('/a'))
      })

      expect(groupIds()).toEqual([listEdgeId('/a')])
    })

    it('onConnect is a no-op for a duplicate connection', () => {
      const result = setup()

      act(() => {
        result.current.onConnect(listConnection('/a'))
        result.current.onConnect(listConnection('/a'))
      })

      expect(edges).toHaveLength(1)
      expect(fieldOrder(concat)).toEqual([listEdgeId('/a')])
    })

    it('onReconnect reorders an edge within the same handle', () => {
      const result = setup()

      act(() => {
        result.current.onConnect(listConnection('/a'))
        result.current.onConnect(listConnection('/b'))
        result.current.onConnect(listConnection('/c'))
      })

      // Drag /a's edge endpoint to the boundary below /c (boundary index 3 of 3 slots)
      act(() => {
        setPendingInsertionIndex({ nodeId: '/concat', handleId: 'par.values', index: 3 })
        const oldEdge = edges.find(e => e.id === listEdgeId('/a'))!
        result.current.onReconnect(oldEdge, listConnection('/a'))
      })

      expect(groupIds()).toEqual([listEdgeId('/b'), listEdgeId('/c'), listEdgeId('/a')])
      expect(edges.map(e => e.data?.orderIndex)).toEqual([0, 1, 2])
      expect(fieldOrder(concat)).toEqual([listEdgeId('/b'), listEdgeId('/c'), listEdgeId('/a')])
    })

    it('onReconnect without a tracked slot leaves order unchanged', () => {
      const result = setup()

      act(() => {
        result.current.onConnect(listConnection('/a'))
        result.current.onConnect(listConnection('/b'))
      })

      act(() => {
        const oldEdge = edges.find(e => e.id === listEdgeId('/a'))!
        result.current.onReconnect(oldEdge, listConnection('/a'))
      })

      expect(groupIds()).toEqual([listEdgeId('/a'), listEdgeId('/b')])
    })

    it('onReconnect to a new source keeps the slot position', () => {
      numberSource('/d', 4)
      const result = setup()

      act(() => {
        result.current.onConnect(listConnection('/a'))
        result.current.onConnect(listConnection('/b'))
        result.current.onConnect(listConnection('/c'))
      })

      // Swap the middle edge's source from /b to /d
      act(() => {
        const oldEdge = edges.find(e => e.id === listEdgeId('/b'))!
        result.current.onReconnect(oldEdge, listConnection('/d'))
      })

      expect(groupIds()).toEqual([listEdgeId('/a'), listEdgeId('/d'), listEdgeId('/c')])
      expect(fieldOrder(concat)).toEqual([listEdgeId('/a'), listEdgeId('/d'), listEdgeId('/c')])
      expect(concat.inputs.values.subscriptions.has(listEdgeId('/b'))).toBe(false)
    })

    it('onReconnect to a different handle disconnects the old field and connects the new one', () => {
      const other = new ConcatOp('/concat-2')
      setOp('/concat-2', other)
      nodes.push({ id: '/concat-2', type: 'ConcatOp', position: { x: 0, y: 0 }, data: {} })
      const result = setup()

      act(() => {
        result.current.onConnect(listConnection('/a'))
        result.current.onConnect(listConnection('/b'))
      })

      act(() => {
        const oldEdge = edges.find(e => e.id === listEdgeId('/b'))!
        result.current.onReconnect(oldEdge, {
          source: '/b',
          target: '/concat-2',
          sourceHandle: 'out.val',
          targetHandle: 'par.values',
        })
      })

      expect(groupIds()).toEqual([listEdgeId('/a')])
      expect(fieldOrder(concat)).toEqual([listEdgeId('/a')])
      expect(fieldOrder(other)).toEqual(['/b.out.val->/concat-2.par.values'])
      // The remaining single-member group is renormalized
      expect(edges.find(e => e.id === listEdgeId('/a'))?.data).toEqual({
        orderIndex: 0,
        groupSize: 1,
      })
    })

    it('deleteEdge closes slot gaps and renormalizes the group', () => {
      const result = setup()

      act(() => {
        result.current.onConnect(listConnection('/a'))
        result.current.onConnect(listConnection('/b'))
        result.current.onConnect(listConnection('/c'))
      })

      act(() => {
        result.current.deleteEdge(listEdgeId('/b'))
      })

      expect(groupIds()).toEqual([listEdgeId('/a'), listEdgeId('/c')])
      expect(edges.map(e => e.data?.orderIndex)).toEqual([0, 1])
      expect(edges.map(e => e.data?.groupSize)).toEqual([2, 2])
    })
  })
})
