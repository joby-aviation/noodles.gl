// Integration tests for node operations (rename, copy/paste, delete)
// Tests renaming nodes with connections, copying containers, and deletion edge cases
import type { Edge as ReactFlowEdge, Node as ReactFlowNode } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearOps,
  deleteOp,
  getAllOps,
  getOp,
  getOpStore,
  hasOp,
  setOp,
} from '../store'
import { transformGraph } from '../transform-graph'
import { edgeId, nodeId } from '../utils/id-utils'
import { getBaseName } from '../utils/path-utils'
import { serializeNodes } from '../utils/serialization'

// Mock Theatre.js studio to avoid side effects
vi.mock('@theatre/studio', () => ({
  default: {
    transaction: vi.fn((fn) => fn({
      __experimental_forgetSheet: vi.fn(),
    })),
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

/**
 * Test Utilities
 */

interface TestGraphOptions {
  withContainer?: boolean
  nestedContainers?: boolean
  withConnections?: boolean
}

/**
 * Creates a test graph with operators and optional containers/connections
 */
function createTestGraph(options: TestGraphOptions = {}) {
  const { withContainer = false, nestedContainers = false, withConnections = true } = options

  const nodes: ReactFlowNode<{ inputs: Record<string, unknown> }>[] = []
  const edges: ReactFlowEdge[] = []

  if (!withContainer) {
    // Simple linear graph: num1 -> add -> multiply
    nodes.push(
      {
        id: '/num1',
        type: 'NumberOp',
        position: { x: 0, y: 0 },
        data: { inputs: { val: 5 } },
      },
      {
        id: '/add',
        type: 'MathOp',
        position: { x: 200, y: 0 },
        data: { inputs: { operator: 'add', b: 10 } },
      },
      {
        id: '/multiply',
        type: 'MathOp',
        position: { x: 400, y: 0 },
        data: { inputs: { operator: 'multiply', b: 2 } },
      }
    )

    if (withConnections) {
      edges.push(
        {
          id: '/num1/out.val->/add/par.a',
          source: '/num1',
          target: '/add',
          sourceHandle: 'out.val',
          targetHandle: 'par.a',
        },
        {
          id: '/add/out.result->/multiply/par.a',
          source: '/add',
          target: '/multiply',
          sourceHandle: 'out.result',
          targetHandle: 'par.a',
        }
      )
    }
  } else {
    // Container with children
    nodes.push(
      {
        id: '/num1',
        type: 'NumberOp',
        position: { x: 0, y: 0 },
        data: { inputs: { val: 5 } },
      },
      {
        id: '/container',
        type: 'ContainerOp',
        position: { x: 200, y: 0 },
        data: { inputs: {} },
      },
      {
        id: '/container/child1',
        type: 'MathOp',
        position: { x: 50, y: 50 },
        parentId: '/container',
        data: { inputs: { operator: 'add', b: 10 } },
      },
      {
        id: '/container/child2',
        type: 'NumberOp',
        position: { x: 50, y: 150 },
        parentId: '/container',
        data: { inputs: { val: 20 } },
      },
      {
        id: '/result',
        type: 'MathOp',
        position: { x: 600, y: 0 },
        data: { inputs: { operator: 'multiply', b: 2 } },
      }
    )

    if (nestedContainers) {
      nodes.push({
        id: '/container/nested',
        type: 'ContainerOp',
        position: { x: 50, y: 250 },
        parentId: '/container',
        data: { inputs: {} },
      })
      nodes.push({
        id: '/container/nested/deepChild',
        type: 'NumberOp',
        position: { x: 50, y: 50 },
        parentId: '/container/nested',
        data: { inputs: { val: 100 } },
      })
    }

    if (withConnections) {
      edges.push(
        {
          id: '/num1/out.val->/container/child1/par.a',
          source: '/num1',
          target: '/container/child1',
          sourceHandle: 'out.val',
          targetHandle: 'par.a',
        },
        {
          id: '/container/child1/out.result->/result/par.a',
          source: '/container/child1',
          target: '/result',
          sourceHandle: 'out.result',
          targetHandle: 'par.a',
        }
      )

      if (nestedContainers) {
        edges.push({
          id: '/container/nested/deepChild/out.val->/result/par.b',
          source: '/container/nested/deepChild',
          target: '/result',
          sourceHandle: 'out.val',
          targetHandle: 'par.b',
        })
      }
    }
  }

  return { nodes, edges }
}

/**
 * Verifies that the graph is consistent between React Flow state and operator store
 */
function verifyGraphConsistency(nodes: ReactFlowNode[], edges: ReactFlowEdge[]) {
  // Every node should have an operator in the store
  for (const node of nodes) {
    expect(hasOp(node.id)).toBe(true)
  }

  // Every operator in edges should exist
  for (const edge of edges) {
    expect(hasOp(edge.source)).toBe(true)
    expect(hasOp(edge.target)).toBe(true)
  }

  // Every edge ID should follow the pattern: source.handle->target.handle
  for (const edge of edges) {
    expect(edge.id).toBe(edgeId(edge))
  }

  // Every child node should have a valid parent
  for (const node of nodes) {
    if (node.parentId) {
      const parent = nodes.find((n) => n.id === node.parentId)
      expect(parent).toBeDefined()
      expect(parent?.type).toBe('ContainerOp')
    }
  }
}

/**
 * Simulates renaming a node by directly calling the same logic as op-components.tsx
 * This tests the rename operation at the store level
 */
function renameNode(
  oldId: string,
  newBaseName: string,
  nodes: ReactFlowNode[],
  edges: ReactFlowEdge[]
): { nodes: ReactFlowNode[]; edges: ReactFlowEdge[] } {
  const op = getOp(oldId)
  if (!op) {
    throw new Error(`Operator not found: ${oldId}`)
  }

  // Generate new qualified ID (assuming no container for simplicity)
  const containerId = op.containerId
  const newQualifiedId = containerId ? `${containerId}/${newBaseName}` : `/${newBaseName}`

  // Check if this is a container
  const node = nodes.find((n) => n.id === oldId)
  const isContainer = node?.type === 'ContainerOp'

  // Update the operator itself
  setOp(newQualifiedId, op)
  op.id = newQualifiedId

  // If container, update all children
  if (isContainer) {
    const childOps = getAllOps().filter((childOp) => childOp.id.startsWith(`${oldId}/`))

    for (const childOp of childOps) {
      const oldChildId = childOp.id
      const newChildId = newQualifiedId + oldChildId.slice(oldId.length)
      setOp(newChildId, childOp)
      childOp.id = newChildId
      queueMicrotask(() => deleteOp(oldChildId))
    }
  }

  // Delete old operator (using microtask like the real code)
  queueMicrotask(() => {
    deleteOp(oldId)
  })

  // Update React Flow nodes
  const updatedNodes = nodes.map((n) => {
    if (n.id === oldId) {
      return { ...n, id: newQualifiedId }
    }
    if (isContainer && n.id.startsWith(`${oldId}/`)) {
      return { ...n, id: newQualifiedId + n.id.slice(oldId.length) }
    }
    return n
  })

  // Update React Flow edges
  const updatedEdges = edges.map((edge) => {
    const sourceNeedsUpdate = edge.source === oldId || (isContainer && edge.source.startsWith(`${oldId}/`))
    const targetNeedsUpdate = edge.target === oldId || (isContainer && edge.target.startsWith(`${oldId}/`))

    if (!sourceNeedsUpdate && !targetNeedsUpdate) return edge

    const updatedEdge = {
      ...edge,
      source: sourceNeedsUpdate
        ? edge.source === oldId
          ? newQualifiedId
          : newQualifiedId + edge.source.slice(oldId.length)
        : edge.source,
      target: targetNeedsUpdate
        ? edge.target === oldId
          ? newQualifiedId
          : newQualifiedId + edge.target.slice(oldId.length)
        : edge.target,
    }

    return { ...updatedEdge, id: edgeId(updatedEdge) }
  })

  return { nodes: updatedNodes, edges: updatedEdges }
}

/**
 * Simulates copy/paste operation
 */
function copyPasteNodes(
  nodesToCopy: ReactFlowNode[],
  edgesToCopy: ReactFlowEdge[],
  allNodes: ReactFlowNode[],
  currentContainerId: string | null = null
): { nodes: ReactFlowNode[]; edges: ReactFlowEdge[] } {
  // Serialize nodes (simulating clipboard)
  const store = getOpStore()
  const serialized = serializeNodes(store, nodesToCopy as ReactFlowNode<Record<string, unknown>>[], edgesToCopy)

  // Deserialize and deconflict IDs
  const idMap = new Map<string, string>()
  const pastedNodes = serialized.map((node) => {
    const baseName = getBaseName(node.id).replace(/-\d+$/, '')
    const newId = nodeId(baseName, currentContainerId)
    idMap.set(node.id, newId)
    return { ...node, id: newId }
  })

  const pastedEdges = edgesToCopy.map((edge) => {
    const source = idMap.get(edge.source) || edge.source
    const target = idMap.get(edge.target) || edge.target
    return {
      ...edge,
      id: edgeId({ ...edge, source, target }),
      source,
      target,
    }
  })

  return { nodes: pastedNodes, edges: pastedEdges }
}

describe('Node Operations Integration Tests', () => {
  beforeEach(() => {
    clearOps()
  })

  afterEach(() => {
    clearOps()
  })

  describe('Node Renaming', () => {
    it('renames a node with connections and preserves edges', async () => {
      const { nodes, edges } = createTestGraph()
      transformGraph({ nodes, edges })

      // Verify initial state
      expect(hasOp('/add')).toBe(true)
      const addOp = getOp('/add')
      expect(addOp?.inputs.a.subscriptions.size).toBe(1)

      // Rename the middle node
      const { nodes: updatedNodes, edges: updatedEdges } = renameNode('/add', 'addition', nodes, edges)

      // Wait for microtasks (the deleteOp calls)
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Update the graph with renamed nodes
      transformGraph({ nodes: updatedNodes, edges: updatedEdges })

      // Old node should be gone
      expect(hasOp('/add')).toBe(false)

      // New node should exist
      expect(hasOp('/addition')).toBe(true)
      const renamedOp = getOp('/addition')
      expect(renamedOp).toBeDefined()
      expect(renamedOp?.inputs.a.subscriptions.size).toBe(1)

      // Edge IDs should be updated
      const incomingEdge = updatedEdges.find((e) => e.target === '/addition')
      expect(incomingEdge).toBeDefined()
      expect(incomingEdge?.id).toBe('/num1/out.val->/addition/par.a')

      const outgoingEdge = updatedEdges.find((e) => e.source === '/addition')
      expect(outgoingEdge).toBeDefined()
      expect(outgoingEdge?.id).toBe('/addition/out.result->/multiply/par.a')

      verifyGraphConsistency(updatedNodes, updatedEdges)
    })

    it('renames a container and updates all child IDs', async () => {
      const { nodes, edges } = createTestGraph({ withContainer: true })
      transformGraph({ nodes, edges })

      // Verify initial state
      expect(hasOp('/container')).toBe(true)
      expect(hasOp('/container/child1')).toBe(true)
      expect(hasOp('/container/child2')).toBe(true)

      // Rename the container
      const { nodes: updatedNodes, edges: updatedEdges } = renameNode(
        '/container',
        'renamed-container',
        nodes,
        edges
      )

      // Wait for microtasks
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Update graph
      transformGraph({ nodes: updatedNodes, edges: updatedEdges })

      // Old container and children should be gone
      expect(hasOp('/container')).toBe(false)
      expect(hasOp('/container/child1')).toBe(false)
      expect(hasOp('/container/child2')).toBe(false)

      // New container and children should exist
      expect(hasOp('/renamed-container')).toBe(true)
      expect(hasOp('/renamed-container/child1')).toBe(true)
      expect(hasOp('/renamed-container/child2')).toBe(true)

      // Edges should be updated
      const childEdge = updatedEdges.find((e) => e.source === '/renamed-container/child1')
      expect(childEdge).toBeDefined()
      expect(childEdge?.id).toContain('/renamed-container/child1')

      verifyGraphConsistency(updatedNodes, updatedEdges)
    })

    it('renames nested containers and updates deeply nested children', async () => {
      const { nodes, edges } = createTestGraph({ withContainer: true, nestedContainers: true })
      transformGraph({ nodes, edges })

      // Verify initial state
      expect(hasOp('/container/nested')).toBe(true)
      expect(hasOp('/container/nested/deepChild')).toBe(true)

      // Rename the parent container
      const { nodes: updatedNodes, edges: updatedEdges } = renameNode(
        '/container',
        'renamed',
        nodes,
        edges
      )

      // Wait for microtasks
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Update graph
      transformGraph({ nodes: updatedNodes, edges: updatedEdges })

      // All nested paths should be updated
      expect(hasOp('/renamed')).toBe(true)
      expect(hasOp('/renamed/nested')).toBe(true)
      expect(hasOp('/renamed/nested/deepChild')).toBe(true)

      // Old paths should be gone
      expect(hasOp('/container')).toBe(false)
      expect(hasOp('/container/nested')).toBe(false)
      expect(hasOp('/container/nested/deepChild')).toBe(false)

      verifyGraphConsistency(updatedNodes, updatedEdges)
    })

    it('handles edge case: prevents false positive matches with similar IDs', async () => {
      // Test the string prefix matching issue: /container-1 vs /container-10
      const nodes: ReactFlowNode[] = [
        {
          id: '/container-1',
          type: 'ContainerOp',
          position: { x: 0, y: 0 },
          data: { inputs: {} },
        },
        {
          id: '/container-1/child',
          type: 'NumberOp',
          position: { x: 50, y: 50 },
          parentId: '/container-1',
          data: { inputs: { val: 1 } },
        },
        {
          id: '/container-10',
          type: 'ContainerOp',
          position: { x: 200, y: 0 },
          data: { inputs: {} },
        },
        {
          id: '/container-10/child',
          type: 'NumberOp',
          position: { x: 50, y: 50 },
          parentId: '/container-10',
          data: { inputs: { val: 10 } },
        },
      ]

      transformGraph({ nodes, edges: [] })

      // Rename container-1
      const { nodes: updatedNodes } = renameNode('/container-1', 'renamed', nodes, [])

      // Wait for microtasks
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Update graph
      transformGraph({ nodes: updatedNodes, edges: [] })

      // container-10 should NOT be affected
      expect(hasOp('/container-10')).toBe(true)
      expect(hasOp('/container-10/child')).toBe(true)

      // Only container-1 should be renamed
      expect(hasOp('/renamed')).toBe(true)
      expect(hasOp('/renamed/child')).toBe(true)
    })
  })

  describe('Copy/Paste Operations', () => {
    it('copies and pastes multiple connected nodes', () => {
      const { nodes, edges } = createTestGraph()
      transformGraph({ nodes, edges })

      // Copy num1 and add nodes
      const nodesToCopy = nodes.filter((n) => n.id === '/num1' || n.id === '/add')
      const edgesToCopy = edges.filter((e) => e.source === '/num1' && e.target === '/add')

      const { nodes: pastedNodes, edges: pastedEdges } = copyPasteNodes(
        nodesToCopy,
        edgesToCopy,
        nodes
      )

      // All pasted nodes in the complete graph
      const allNodes = [...nodes, ...pastedNodes]
      const allEdges = [...edges, ...pastedEdges]

      // Transform with new nodes
      transformGraph({ nodes: allNodes, edges: allEdges })

      // Verify new nodes were created with different IDs
      expect(pastedNodes.length).toBe(2)
      expect(pastedNodes[0].id).not.toBe('/num1')
      expect(pastedNodes[1].id).not.toBe('/add')

      // Verify edge was remapped
      expect(pastedEdges.length).toBe(1)
      expect(pastedEdges[0].source).toBe(pastedNodes[0].id)
      expect(pastedEdges[0].target).toBe(pastedNodes[1].id)

      verifyGraphConsistency(allNodes, allEdges)
    })

    it('copies a container and includes all children', () => {
      const { nodes, edges } = createTestGraph({ withContainer: true })
      transformGraph({ nodes, edges })

      // Copy container (should auto-include children in real implementation)
      const container = nodes.find((n) => n.id === '/container')!
      const children = nodes.filter((n) => n.parentId === '/container')

      const nodesToCopy = [container, ...children]
      const edgesToCopy = edges.filter(
        (e) =>
          (e.source === container.id || e.source.startsWith(`${container.id}/`)) &&
          (e.target === container.id || e.target.startsWith(`${container.id}/`))
      )

      const { nodes: pastedNodes, edges: pastedEdges } = copyPasteNodes(
        nodesToCopy,
        edgesToCopy,
        nodes
      )

      const allNodes = [...nodes, ...pastedNodes]
      const allEdges = [...edges, ...pastedEdges]

      transformGraph({ nodes: allNodes, edges: allEdges })

      // Verify container was copied
      const newContainer = pastedNodes.find((n) => n.type === 'ContainerOp')
      expect(newContainer).toBeDefined()
      expect(newContainer?.id).not.toBe('/container')

      // Verify children were copied
      const newChildren = pastedNodes.filter((n) => n.parentId === newContainer?.id)
      expect(newChildren.length).toBe(2)

      // Verify children have correct parent ID
      for (const child of newChildren) {
        expect(child.parentId).toBe(newContainer?.id)
        expect(child.id.startsWith(`${newContainer?.id}/`)).toBe(true)
      }

      verifyGraphConsistency(allNodes, allEdges)
    })

    it('copies nested containers and preserves hierarchy', () => {
      const { nodes, edges } = createTestGraph({ withContainer: true, nestedContainers: true })
      transformGraph({ nodes, edges })

      // Copy parent container with all descendants
      const container = nodes.find((n) => n.id === '/container')!
      const allDescendants = nodes.filter((n) => n.id.startsWith(`${container.id}/`))

      const nodesToCopy = [container, ...allDescendants]
      const edgesToCopy = edges.filter(
        (e) =>
          nodesToCopy.some((n) => n.id === e.source) && nodesToCopy.some((n) => n.id === e.target)
      )

      const { nodes: pastedNodes } = copyPasteNodes(nodesToCopy, edgesToCopy, nodes)

      const allNodes = [...nodes, ...pastedNodes]

      // Find the new nested structure
      const newContainer = pastedNodes.find((n) => n.type === 'ContainerOp' && !n.parentId)
      const newNested = pastedNodes.find(
        (n) => n.type === 'ContainerOp' && n.parentId === newContainer?.id
      )
      const newDeepChild = pastedNodes.find((n) => n.parentId === newNested?.id)

      expect(newContainer).toBeDefined()
      expect(newNested).toBeDefined()
      expect(newDeepChild).toBeDefined()

      // Verify hierarchy
      expect(newNested?.parentId).toBe(newContainer?.id)
      expect(newDeepChild?.parentId).toBe(newNested?.id)
      expect(newDeepChild?.id.startsWith(`${newNested?.id}/`)).toBe(true)
    })

    it('generates unique IDs when pasting same nodes multiple times', () => {
      const { nodes, edges } = createTestGraph()
      transformGraph({ nodes, edges })

      const nodeToCopy = nodes.find((n) => n.id === '/num1')!

      // Paste once
      const { nodes: pastedNodes1 } = copyPasteNodes([nodeToCopy], [], nodes)

      // Paste again
      const allNodesAfterFirst = [...nodes, ...pastedNodes1]
      const { nodes: pastedNodes2 } = copyPasteNodes([nodeToCopy], [], allNodesAfterFirst)

      // All three should have different IDs
      expect(pastedNodes1[0].id).not.toBe(nodeToCopy.id)
      expect(pastedNodes2[0].id).not.toBe(nodeToCopy.id)
      expect(pastedNodes2[0].id).not.toBe(pastedNodes1[0].id)
    })

    it('preserves edges between copied nodes and remaps IDs correctly', () => {
      const { nodes, edges } = createTestGraph()
      transformGraph({ nodes, edges })

      // Copy all three nodes
      const { nodes: pastedNodes, edges: pastedEdges } = copyPasteNodes(nodes, edges, nodes)

      // Transform graph with pasted nodes
      const allNodes = [...nodes, ...pastedNodes]
      const allEdges = [...edges, ...pastedEdges]
      transformGraph({ nodes: allNodes, edges: allEdges })

      // Verify edges were remapped correctly
      expect(pastedEdges.length).toBe(2)

      for (const edge of pastedEdges) {
        // Source and target should be in pasted nodes
        expect(pastedNodes.some((n) => n.id === edge.source)).toBe(true)
        expect(pastedNodes.some((n) => n.id === edge.target)).toBe(true)

        // Edge ID should match the pattern
        expect(edge.id).toBe(edgeId(edge))
      }

      verifyGraphConsistency(allNodes, allEdges)
    })
  })

  describe('Node Deletion', () => {
    it('deletes a node and removes it from store', () => {
      const { nodes, edges } = createTestGraph()
      transformGraph({ nodes, edges })

      expect(hasOp('/add')).toBe(true)

      // Delete the node
      const updatedNodes = nodes.filter((n) => n.id !== '/add')
      const updatedEdges = edges.filter((e) => e.source !== '/add' && e.target !== '/add')

      transformGraph({ nodes: updatedNodes, edges: updatedEdges })

      expect(hasOp('/add')).toBe(false)
      expect(hasOp('/num1')).toBe(true)
      expect(hasOp('/multiply')).toBe(true)

      verifyGraphConsistency(updatedNodes, updatedEdges)
    })

    it('deletes a container and removes all children from store', () => {
      const { nodes, edges } = createTestGraph({ withContainer: true })
      transformGraph({ nodes, edges })

      expect(hasOp('/container')).toBe(true)
      expect(hasOp('/container/child1')).toBe(true)
      expect(hasOp('/container/child2')).toBe(true)

      // Delete container
      const updatedNodes = nodes.filter(
        (n) => n.id !== '/container' && !n.id.startsWith('/container/')
      )
      const updatedEdges = edges.filter(
        (e) =>
          !e.source.startsWith('/container') &&
          !e.target.startsWith('/container')
      )

      transformGraph({ nodes: updatedNodes, edges: updatedEdges })

      // All should be removed
      expect(hasOp('/container')).toBe(false)
      expect(hasOp('/container/child1')).toBe(false)
      expect(hasOp('/container/child2')).toBe(false)

      verifyGraphConsistency(updatedNodes, updatedEdges)
    })

    it('handles rapid deletion without race conditions', async () => {
      const { nodes, edges } = createTestGraph()
      transformGraph({ nodes, edges })

      // Delete multiple nodes rapidly
      let currentNodes = nodes
      let currentEdges = edges

      // Delete add
      currentNodes = currentNodes.filter((n) => n.id !== '/add')
      currentEdges = currentEdges.filter((e) => e.source !== '/add' && e.target !== '/add')

      // Delete multiply immediately after
      currentNodes = currentNodes.filter((n) => n.id !== '/multiply')
      currentEdges = currentEdges.filter((e) => e.source !== '/multiply' && e.target !== '/multiply')

      // Transform once with all deletions
      transformGraph({ nodes: currentNodes, edges: currentEdges })

      // Wait for any microtasks
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Verify state is consistent
      expect(hasOp('/add')).toBe(false)
      expect(hasOp('/multiply')).toBe(false)
      expect(hasOp('/num1')).toBe(true)

      verifyGraphConsistency(currentNodes, currentEdges)
    })

    it('handles ForLoop special case deletion', () => {
      // Create ForLoop nodes (begin, end, container)
      const nodes: ReactFlowNode[] = [
        {
          id: '/loop',
          type: 'ForLoopOp',
          position: { x: 0, y: 0 },
          data: { inputs: {} },
        },
        {
          id: '/loop/begin',
          type: 'ForLoopBeginOp',
          position: { x: 50, y: 50 },
          parentId: '/loop',
          data: { inputs: {} },
        },
        {
          id: '/loop/end',
          type: 'ForLoopEndOp',
          position: { x: 50, y: 150 },
          parentId: '/loop',
          data: { inputs: {} },
        },
      ]

      transformGraph({ nodes, edges: [] })

      expect(hasOp('/loop')).toBe(true)
      expect(hasOp('/loop/begin')).toBe(true)
      expect(hasOp('/loop/end')).toBe(true)

      // Delete begin node (should trigger special handling in real code)
      // For now, we'll just verify basic cleanup
      const updatedNodes = nodes.filter((n) => n.id !== '/loop/begin')

      transformGraph({ nodes: updatedNodes, edges: [] })

      expect(hasOp('/loop/begin')).toBe(false)
    })
  })

  describe('Combined Operations', () => {
    it('renames a node then copies it', async () => {
      const { nodes, edges } = createTestGraph()
      transformGraph({ nodes, edges })

      // Rename add -> addition
      const { nodes: renamedNodes, edges: renamedEdges } = renameNode('/add', 'addition', nodes, edges)

      // Wait for microtasks
      await new Promise((resolve) => setTimeout(resolve, 10))

      transformGraph({ nodes: renamedNodes, edges: renamedEdges })

      // Copy the renamed node
      const nodeToCopy = renamedNodes.find((n) => n.id === '/addition')!
      const { nodes: pastedNodes } = copyPasteNodes([nodeToCopy], [], renamedNodes)

      // Verify new copy has different ID
      expect(pastedNodes[0].id).not.toBe('/addition')
      expect(pastedNodes[0].id).toMatch(/^\/addition-\d+$/)
    })

    it('copies, pastes, and then renames the pasted node', async () => {
      const { nodes, edges } = createTestGraph()
      transformGraph({ nodes, edges })

      // Copy num1
      const nodeToCopy = nodes.find((n) => n.id === '/num1')!
      const { nodes: pastedNodes } = copyPasteNodes([nodeToCopy], [], nodes)

      const allNodes = [...nodes, ...pastedNodes]
      transformGraph({ nodes: allNodes, edges })

      // Rename the pasted node
      const { nodes: renamedNodes } = renameNode(pastedNodes[0].id, 'custom-name', allNodes, edges)

      // Wait for microtasks
      await new Promise((resolve) => setTimeout(resolve, 10))

      transformGraph({ nodes: renamedNodes, edges })

      // Verify renamed node exists
      expect(hasOp('/custom-name')).toBe(true)
      expect(hasOp(pastedNodes[0].id)).toBe(false)
    })

    it('copies a container, pastes it, then renames the pasted container', async () => {
      const { nodes, edges } = createTestGraph({ withContainer: true })
      transformGraph({ nodes, edges })

      // Copy container with children
      const container = nodes.find((n) => n.id === '/container')!
      const children = nodes.filter((n) => n.parentId === '/container')
      const nodesToCopy = [container, ...children]

      const { nodes: pastedNodes } = copyPasteNodes(nodesToCopy, [], nodes)

      let allNodes = [...nodes, ...pastedNodes]
      transformGraph({ nodes: allNodes, edges })

      // Find pasted container
      const pastedContainer = pastedNodes.find((n) => n.type === 'ContainerOp')!

      // Rename pasted container
      const { nodes: renamedNodes } = renameNode(pastedContainer.id, 'new-container', allNodes, edges)

      // Wait for microtasks
      await new Promise((resolve) => setTimeout(resolve, 10))

      transformGraph({ nodes: renamedNodes, edges })

      // Verify renamed container and its children
      expect(hasOp('/new-container')).toBe(true)
      expect(hasOp('/new-container/child1')).toBe(true)
      expect(hasOp('/new-container/child2')).toBe(true)

      // Old IDs should be gone
      expect(hasOp(pastedContainer.id)).toBe(false)
    })
  })
})
