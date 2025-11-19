// Integration test for node renaming race condition
// Tests that renaming nodes with upstream connections doesn't crash
import type { Node as ReactFlowNode } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearOps, deleteOp, getOp, getOpStore, hasOp, setOp } from '../store'
import { transformGraph } from '../transform-graph'
import { edgeId } from '../utils/id-utils'
import { generateQualifiedPath } from '../utils/path-utils'
// Import operators to ensure they're registered before tests run
import '../operators'

// Mock Theatre.js studio to avoid side effects
vi.mock('@theatre/studio', () => ({
  default: {
    transaction: vi.fn(fn =>
      fn({
        __experimental_forgetSheet: vi.fn(),
      })
    ),
    setSelection: vi.fn(),
    createContentOfSaveFile: vi.fn(() => ({ sheetsById: {} })),
  },
}))

// Mock globals to avoid window dependency
vi.mock('../globals', () => ({
  projectId: 'test-project',
  safeMode: false,
  IS_PROD: false,
  DEFAULT_LATITUDE: 40.7128,
  DEFAULT_LONGITUDE: -74.006,
}))

describe('Node Rename Race Condition', () => {
  beforeEach(() => {
    clearOps()
  })

  afterEach(() => {
    clearOps()
  })

  it('handles renaming a node with upstream connections without crashing', () => {
    // Create a simple graph: data -> viewer
    const nodes: ReactFlowNode<{ inputs: Record<string, unknown> }>[] = [
      {
        id: '/data',
        type: 'NumberOp',
        position: { x: 0, y: 0 },
        data: { inputs: { val: 42 } },
      },
      {
        id: '/viewer',
        type: 'MathOp',
        position: { x: 200, y: 0 },
        data: { inputs: { operator: 'add', b: 10 } },
      },
    ]

    const edge = {
      source: '/data',
      target: '/viewer',
      sourceHandle: 'out.val',
      targetHandle: 'par.a',
    }
    const edges = [{ ...edge, id: edgeId(edge) }]

    // Initial transform - creates operators
    transformGraph({ nodes, edges })

    // Verify initial state
    expect(hasOp('/data')).toBe(true)
    expect(hasOp('/viewer')).toBe(true)
    const viewerOp = getOp('/viewer')
    expect(viewerOp).toBeDefined()
    expect(viewerOp?.inputs.a.subscriptions.size).toBe(1)

    // Simulate the rename operation as it happens in NodeHeader.updateId
    const oldId = '/viewer'
    const newBaseName = 'view'
    const newQualifiedId = generateQualifiedPath(newBaseName, '/')

    // Step 1: Add operator with new ID (happens immediately)
    const op = getOp(oldId)!
    setOp(newQualifiedId, op)
    op.id = newQualifiedId

    // Step 2: This simulates the race condition window
    // The old operator still exists in the store, but transformGraph will be called
    // with updated nodes before the old ID is deleted
    expect(hasOp(oldId)).toBe(true) // Old still exists
    expect(hasOp(newQualifiedId)).toBe(true) // New exists too

    // Step 3: Update React Flow nodes and edges (what setNodes/setEdges does)
    const updatedNodes = nodes.map(n => (n.id === oldId ? { ...n, id: newQualifiedId } : n))

    const updatedEdges = edges.map(e => {
      const updatedEdge = {
        ...e,
        target: e.target === oldId ? newQualifiedId : e.target,
      }
      return { ...updatedEdge, id: edgeId(updatedEdge) }
    })

    // Step 4: transformGraph is called with updated nodes
    // During this call, components may render with the old ID from React Flow's internal state
    // This is where the crash would happen if useOp throws
    transformGraph({ nodes: updatedNodes, edges: updatedEdges })

    // Step 5: Delete old operator (happens in queueMicrotask)
    deleteOp(oldId)

    // Verify final state
    expect(hasOp(oldId)).toBe(false) // Old is gone
    expect(hasOp(newQualifiedId)).toBe(true) // New exists
    const renamedOp = getOp(newQualifiedId)
    expect(renamedOp).toBeDefined()
    expect(renamedOp?.inputs.a.subscriptions.size).toBe(1) // Connection preserved
  })

  it('handles renaming with multiple upstream connections', () => {
    // Create a graph with multiple inputs: data1, data2 -> viewer
    const nodes: ReactFlowNode<{ inputs: Record<string, unknown> }>[] = [
      {
        id: '/data1',
        type: 'NumberOp',
        position: { x: 0, y: 0 },
        data: { inputs: { val: 10 } },
      },
      {
        id: '/data2',
        type: 'NumberOp',
        position: { x: 0, y: 100 },
        data: { inputs: { val: 20 } },
      },
      {
        id: '/viewer',
        type: 'MathOp',
        position: { x: 200, y: 50 },
        data: { inputs: { operator: 'add', b: 0 } },
      },
    ]

    const edge1 = {
      source: '/data1',
      target: '/viewer',
      sourceHandle: 'out.val',
      targetHandle: 'par.a',
    }
    const edge2 = {
      source: '/data2',
      target: '/viewer',
      sourceHandle: 'out.val',
      targetHandle: 'par.b',
    }
    const edges = [
      { ...edge1, id: edgeId(edge1) },
      { ...edge2, id: edgeId(edge2) },
    ]

    transformGraph({ nodes, edges })

    // Verify initial state
    expect(hasOp('/viewer')).toBe(true)
    const viewerOp = getOp('/viewer')
    expect(viewerOp?.inputs.a.subscriptions.size).toBe(1)
    expect(viewerOp?.inputs.b.subscriptions.size).toBe(1)

    // Simulate rename with both connections intact
    const oldId = '/viewer'
    const newQualifiedId = '/renamed-viewer'
    const op = getOp(oldId)!

    setOp(newQualifiedId, op)
    op.id = newQualifiedId

    const updatedNodes = nodes.map(n => (n.id === oldId ? { ...n, id: newQualifiedId } : n))

    const updatedEdges = edges.map(e => {
      const updatedEdge = {
        ...e,
        target: e.target === oldId ? newQualifiedId : e.target,
      }
      return { ...updatedEdge, id: edgeId(updatedEdge) }
    })

    // This should not crash even with multiple connections
    transformGraph({ nodes: updatedNodes, edges: updatedEdges })

    deleteOp(oldId)

    // Verify all connections preserved
    const renamedOp = getOp(newQualifiedId)
    expect(renamedOp).toBeDefined()
    expect(renamedOp?.inputs.a.subscriptions.size).toBe(1)
    expect(renamedOp?.inputs.b.subscriptions.size).toBe(1)
  })

  it('handles renaming a node that is both upstream and downstream', () => {
    // Create a chain: source -> middle -> sink
    const nodes: ReactFlowNode<{ inputs: Record<string, unknown> }>[] = [
      {
        id: '/source',
        type: 'NumberOp',
        position: { x: 0, y: 0 },
        data: { inputs: { val: 5 } },
      },
      {
        id: '/middle',
        type: 'MathOp',
        position: { x: 200, y: 0 },
        data: { inputs: { operator: 'add', b: 10 } },
      },
      {
        id: '/sink',
        type: 'MathOp',
        position: { x: 400, y: 0 },
        data: { inputs: { operator: 'multiply', b: 2 } },
      },
    ]

    const edge1 = {
      source: '/source',
      target: '/middle',
      sourceHandle: 'out.val',
      targetHandle: 'par.a',
    }
    const edge2 = {
      source: '/middle',
      target: '/sink',
      sourceHandle: 'out.result',
      targetHandle: 'par.a',
    }
    const edges = [
      { ...edge1, id: edgeId(edge1) },
      { ...edge2, id: edgeId(edge2) },
    ]

    transformGraph({ nodes, edges })

    // Rename the middle node
    const oldId = '/middle'
    const newQualifiedId = '/processor'
    const op = getOp(oldId)!

    setOp(newQualifiedId, op)
    op.id = newQualifiedId

    const updatedNodes = nodes.map(n => (n.id === oldId ? { ...n, id: newQualifiedId } : n))

    const updatedEdges = edges.map(e => {
      const updatedEdge = {
        ...e,
        source: e.source === oldId ? newQualifiedId : e.source,
        target: e.target === oldId ? newQualifiedId : e.target,
      }
      return { ...updatedEdge, id: edgeId(updatedEdge) }
    })

    // Should handle both incoming and outgoing connections
    transformGraph({ nodes: updatedNodes, edges: updatedEdges })

    deleteOp(oldId)

    // Verify
    expect(hasOp(newQualifiedId)).toBe(true)
    expect(hasOp(oldId)).toBe(false)
    const renamedOp = getOp(newQualifiedId)
    expect(renamedOp?.inputs.a.subscriptions.size).toBe(1) // Incoming from source
  })

  it('getOp returns undefined during the race condition window', () => {
    // This test verifies that getOp gracefully returns undefined
    // when an operator doesn't exist, which is what happens during
    // the race condition

    expect(getOp('/nonexistent')).toBeUndefined()

    // Create and then delete an operator
    const nodes: ReactFlowNode<{ inputs: Record<string, unknown> }>[] = [
      {
        id: '/temp',
        type: 'NumberOp',
        position: { x: 0, y: 0 },
        data: { inputs: { val: 1 } },
      },
    ]

    transformGraph({ nodes, edges: [] })
    expect(getOp('/temp')).toBeDefined()

    deleteOp('/temp')
    expect(getOp('/temp')).toBeUndefined()
  })

  it('store batching ensures atomic rename operations', () => {
    // This test verifies that using getOpStore().batch() ensures atomic updates
    // and prevents the race condition window where both old and new IDs coexist

    const nodes: ReactFlowNode<{ inputs: Record<string, unknown> }>[] = [
      {
        id: '/data',
        type: 'NumberOp',
        position: { x: 0, y: 0 },
        data: { inputs: { val: 42 } },
      },
      {
        id: '/viewer',
        type: 'MathOp',
        position: { x: 200, y: 0 },
        data: { inputs: { operator: 'add', b: 10 } },
      },
    ]

    const edge = {
      source: '/data',
      target: '/viewer',
      sourceHandle: 'out.val',
      targetHandle: 'par.a',
    }
    const edges = [{ ...edge, id: edgeId(edge) }]

    transformGraph({ nodes, edges })

    // Track store update notifications
    let updateCount = 0
    const unsubscribe = getOpStore().subscribe(() => {
      updateCount++
    })

    // Simulate batched rename (as implemented in the fix)
    const oldId = '/viewer'
    const newQualifiedId = '/view'
    const op = getOp(oldId)!

    // Using batch() should cause only ONE store update
    getOpStore().batch(() => {
      setOp(newQualifiedId, op)
      op.id = newQualifiedId
      deleteOp(oldId)
    })

    // Verify only one update notification was sent
    expect(updateCount).toBe(1)

    // Verify final state is clean
    expect(hasOp(oldId)).toBe(false)
    expect(hasOp(newQualifiedId)).toBe(true)

    // Cleanup
    unsubscribe()
  })

  it('batched rename with container children triggers single update', () => {
    // Test that renaming a container with children in a batch
    // results in a single atomic store update

    const nodes: ReactFlowNode<{ inputs: Record<string, unknown> }>[] = [
      {
        id: '/container',
        type: 'ContainerOp',
        position: { x: 0, y: 0 },
        data: { inputs: {} },
      },
      {
        id: '/container/child1',
        type: 'NumberOp',
        position: { x: 50, y: 50 },
        data: { inputs: { val: 1 } },
      },
      {
        id: '/container/child2',
        type: 'NumberOp',
        position: { x: 50, y: 150 },
        data: { inputs: { val: 2 } },
      },
    ]

    transformGraph({ nodes, edges: [] })

    // Track updates
    let updateCount = 0
    const unsubscribe = getOpStore().subscribe(() => {
      updateCount++
    })

    // Simulate batched container rename with children
    const oldId = '/container'
    const newQualifiedId = '/renamed-container'

    getOpStore().batch(() => {
      // Rename container
      const containerOp = getOp(oldId)!
      setOp(newQualifiedId, containerOp)
      containerOp.id = newQualifiedId

      // Rename all children
      const childOps = [getOp('/container/child1')!, getOp('/container/child2')!]
      for (const childOp of childOps) {
        const oldChildId = childOp.id
        const newChildId = newQualifiedId + oldChildId.slice(oldId.length)
        setOp(newChildId, childOp)
        childOp.id = newChildId
        deleteOp(oldChildId)
      }

      // Delete old container
      deleteOp(oldId)
    })

    // Should be exactly one update despite multiple operations
    expect(updateCount).toBe(1)

    // Verify all operations succeeded
    expect(hasOp(oldId)).toBe(false)
    expect(hasOp(newQualifiedId)).toBe(true)
    expect(hasOp('/container/child1')).toBe(false)
    expect(hasOp('/container/child2')).toBe(false)
    expect(hasOp('/renamed-container/child1')).toBe(true)
    expect(hasOp('/renamed-container/child2')).toBe(true)

    unsubscribe()
  })

  it('non-batched operations trigger multiple updates (demonstrates old behavior)', () => {
    // This test shows what happens WITHOUT batching - multiple updates
    // which creates the race condition window

    const nodes: ReactFlowNode<{ inputs: Record<string, unknown> }>[] = [
      {
        id: '/node',
        type: 'NumberOp',
        position: { x: 0, y: 0 },
        data: { inputs: { val: 5 } },
      },
    ]

    transformGraph({ nodes, edges: [] })

    // Track updates
    let updateCount = 0
    const unsubscribe = getOpStore().subscribe(() => {
      updateCount++
    })

    // Simulate non-batched rename (old buggy behavior)
    const oldId = '/node'
    const newQualifiedId = '/renamed-node'
    const op = getOp(oldId)!

    // Without batch(), each operation triggers an update
    setOp(newQualifiedId, op) // Update 1
    op.id = newQualifiedId
    deleteOp(oldId) // Update 2

    // Should have triggered 2 updates (the race condition window)
    expect(updateCount).toBe(2)

    unsubscribe()
  })
})
