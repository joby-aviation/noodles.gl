// Tests for operations that must cascade across container scope boundaries.
// The "class of bug" being tested: ReactFlow only sees displayedNodes (current scope),
// but operations like delete, copy, and undo must affect ALL nodes including
// out-of-scope container children that use path-based nesting.
import type { Edge as ReactFlowEdge, Node as ReactFlowNode } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearOps, hasOp } from '../store'
import { transformGraph } from '../transform-graph'
import {
  collectContainerChildren,
  expandDeleteSet,
  remapPastedIds,
} from '../utils/copy-paste-utils'
import { edgeId } from '../utils/id-utils'
import { getParentPath } from '../utils/path-utils'
import '../operators'

vi.mock('../globals', () => ({
  projectId: 'test-project',
  safeMode: false,
  IS_PROD: false,
  DEFAULT_LATITUDE: 40.7128,
  DEFAULT_LONGITUDE: -74.006,
}))

// Simulates the displayedNodes filter from noodles.tsx line 932
// This is what ReactFlow actually sees — only nodes at the current scope level
function getDisplayedNodes(allNodes: ReactFlowNode[], currentContainerId: string) {
  const targetContainer = currentContainerId || '/'
  return allNodes.filter(node => (getParentPath(node.id) ?? '/') === targetContainer)
}

// Simulates the edge filter (activeEdges) from noodles.tsx
function getActiveEdges(allEdges: ReactFlowEdge[], visibleNodeIds: Set<string>) {
  return allEdges.filter(e => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target))
}

function makeNode(id: string, type = 'NumberOp'): ReactFlowNode<{ inputs: Record<string, unknown> }> {
  return { id, type, position: { x: 0, y: 0 }, data: { inputs: {} } }
}

function makeEdge(source: string, sourceHandle: string, target: string, targetHandle: string): ReactFlowEdge {
  const e = { source, target, sourceHandle, targetHandle }
  return { ...e, id: edgeId(e) }
}

// Creates a realistic container graph as used throughout the app
function createContainerGraph() {
  const nodes: ReactFlowNode<{ inputs: Record<string, unknown> }>[] = [
    makeNode('/source', 'NumberOp'),
    makeNode('/container', 'ContainerOp'),
    makeNode('/container/container-input', 'GraphInputOp'),
    makeNode('/container/container-output', 'GraphOutputOp'),
    makeNode('/container/worker', 'MathOp'),
    makeNode('/sink', 'MathOp'),
  ]

  const edges: ReactFlowEdge[] = [
    makeEdge('/container', 'par.in', '/container/container-input', 'par.parentValue'),
    makeEdge('/container/container-output', 'out.propagatedValue', '/container', 'out.out'),
    makeEdge('/source', 'out.val', '/container', 'par.in'),
    makeEdge('/container', 'out.out', '/sink', 'par.a'),
    makeEdge('/container/container-input', 'out.parentValue', '/container/worker', 'par.a'),
  ]

  return { nodes, edges }
}

// Creates a graph with nested containers (container within a container)
function createNestedContainerGraph() {
  const { nodes, edges } = createContainerGraph()

  nodes.push(
    makeNode('/container/nested', 'ContainerOp'),
    makeNode('/container/nested/container-input', 'GraphInputOp'),
    makeNode('/container/nested/container-output', 'GraphOutputOp'),
    makeNode('/container/nested/deep', 'NumberOp'),
  )

  edges.push(
    makeEdge('/container/nested', 'par.in', '/container/nested/container-input', 'par.parentValue'),
    makeEdge('/container/nested/container-output', 'out.propagatedValue', '/container/nested', 'out.out'),
    makeEdge('/container/nested/deep', 'out.val', '/container/nested/container-output', 'par.value'),
  )

  return { nodes, edges }
}

describe('Container Scope Operations', () => {
  beforeEach(() => clearOps())
  afterEach(() => clearOps())

  describe('scope filtering (displayedNodes model)', () => {
    it('root scope only shows root-level nodes, not container children', () => {
      const { nodes } = createContainerGraph()
      const displayed = getDisplayedNodes(nodes, '/')

      expect(displayed.map(n => n.id).sort()).toEqual(['/container', '/sink', '/source'])
      expect(displayed.find(n => n.id === '/container/worker')).toBeUndefined()
    })

    it('container scope shows only direct children', () => {
      const { nodes } = createContainerGraph()
      const displayed = getDisplayedNodes(nodes, '/container')

      expect(displayed.map(n => n.id).sort()).toEqual([
        '/container/container-input',
        '/container/container-output',
        '/container/worker',
      ])
    })

    it('nested container scope only shows its own children', () => {
      const { nodes } = createNestedContainerGraph()
      const displayed = getDisplayedNodes(nodes, '/container/nested')

      expect(displayed.map(n => n.id).sort()).toEqual([
        '/container/nested/container-input',
        '/container/nested/container-output',
        '/container/nested/deep',
      ])
    })
  })

  describe('delete cascades across scope boundaries', () => {
    it('deleting container from root scope removes all children', () => {
      const { nodes, edges } = createContainerGraph()
      transformGraph({ nodes, edges })

      // User is at root scope — they only see /container, not its children
      const displayed = getDisplayedNodes(nodes, '/')
      expect(displayed.find(n => n.id === '/container')).toBeDefined()

      // Simulate: user selects /container and presses Delete
      // expandDeleteSet is what our production code calls
      const deleteIds = new Set(['/container'])
      expandDeleteSet(deleteIds, nodes)

      // All path-based children must be included
      expect(deleteIds.has('/container/container-input')).toBe(true)
      expect(deleteIds.has('/container/container-output')).toBe(true)
      expect(deleteIds.has('/container/worker')).toBe(true)
      // Non-children must NOT be included
      expect(deleteIds.has('/source')).toBe(false)
      expect(deleteIds.has('/sink')).toBe(false)
    })

    it('deleting container cascades through nested containers', () => {
      const { nodes } = createNestedContainerGraph()

      const deleteIds = new Set(['/container'])
      expandDeleteSet(deleteIds, nodes)

      // Must include deeply nested children
      expect(deleteIds.has('/container/nested')).toBe(true)
      expect(deleteIds.has('/container/nested/container-input')).toBe(true)
      expect(deleteIds.has('/container/nested/container-output')).toBe(true)
      expect(deleteIds.has('/container/nested/deep')).toBe(true)
    })

    it('edges referencing deleted children are removed', () => {
      const { nodes, edges } = createContainerGraph()

      const deleteIds = new Set(['/container'])
      expandDeleteSet(deleteIds, nodes)

      const survivingEdges = edges.filter(
        e => !deleteIds.has(e.source) && !deleteIds.has(e.target)
      )

      // Only edges between /source and /sink survive (but there aren't any direct ones)
      // All edges touching /container or its children should be gone
      for (const edge of survivingEdges) {
        expect(edge.source.startsWith('/container')).toBe(false)
        expect(edge.target.startsWith('/container')).toBe(false)
      }
    })

    it('operator store is cleaned up after cascaded deletion', () => {
      const { nodes, edges } = createContainerGraph()
      transformGraph({ nodes, edges })

      expect(hasOp('/container/worker')).toBe(true)
      expect(hasOp('/container/container-input')).toBe(true)

      // Simulate full delete flow: expand IDs, remove from nodes, re-transform
      const deleteIds = new Set(['/container'])
      expandDeleteSet(deleteIds, nodes)

      const remainingNodes = nodes.filter(n => !deleteIds.has(n.id))
      const remainingEdges = edges.filter(
        e => !deleteIds.has(e.source) && !deleteIds.has(e.target)
      )
      transformGraph({ nodes: remainingNodes, edges: remainingEdges })

      expect(hasOp('/container')).toBe(false)
      expect(hasOp('/container/worker')).toBe(false)
      expect(hasOp('/container/container-input')).toBe(false)
      expect(hasOp('/container/container-output')).toBe(false)
      // Non-deleted ops survive
      expect(hasOp('/source')).toBe(true)
      expect(hasOp('/sink')).toBe(true)
    })
  })

  describe('copy collects children across scope boundaries', () => {
    it('copying a container from root scope includes all children and internal edges', () => {
      const { nodes, edges } = createContainerGraph()

      // User selects /container at root scope (children are NOT in displayedNodes)
      const selectedNodes = [nodes.find(n => n.id === '/container')!]
      const { additionalNodes, additionalEdges } = collectContainerChildren(
        selectedNodes,
        nodes,
        edges
      )

      const collectedIds = additionalNodes.map(n => n.id).sort()
      expect(collectedIds).toEqual([
        '/container/container-input',
        '/container/container-output',
        '/container/worker',
      ])

      // Internal edges (both endpoints inside the container) should be collected
      expect(additionalEdges.length).toBeGreaterThan(0)
      for (const edge of additionalEdges) {
        expect(edge.source.startsWith('/container')).toBe(true)
        expect(edge.target.startsWith('/container')).toBe(true)
      }
    })

    it('copying nested containers collects all descendants', () => {
      const { nodes, edges } = createNestedContainerGraph()

      const selectedNodes = [nodes.find(n => n.id === '/container')!]
      const { additionalNodes } = collectContainerChildren(selectedNodes, nodes, edges)

      const collectedIds = new Set(additionalNodes.map(n => n.id))
      expect(collectedIds.has('/container/nested')).toBe(true)
      expect(collectedIds.has('/container/nested/deep')).toBe(true)
      expect(collectedIds.has('/container/nested/container-input')).toBe(true)
    })

    it('pasting a copied container produces correctly namespaced children', () => {
      const { nodes, edges } = createContainerGraph()
      transformGraph({ nodes, edges })

      // Collect container + children (what doCopy does)
      const containerNode = nodes.find(n => n.id === '/container')!
      const { additionalNodes, additionalEdges } = collectContainerChildren(
        [containerNode],
        nodes,
        edges
      )

      const nodesToPaste = [containerNode, ...additionalNodes]
      const edgesToPaste = additionalEdges
      const existingIds = new Set(nodes.map(n => n.id))

      // Paste (what doPaste does via remapPastedIds)
      const { nodes: pastedNodes, edges: pastedEdges, idMap } = remapPastedIds(
        nodesToPaste,
        edgesToPaste,
        undefined, // paste at root
        existingIds
      )

      // The new container got a different ID
      const newContainer = pastedNodes.find(n => n.type === 'ContainerOp')!
      expect(newContainer.id).not.toBe('/container')

      // Children are namespaced under the new container
      const children = pastedNodes.filter(n => n.id !== newContainer.id)
      for (const child of children) {
        expect(child.id.startsWith(`${newContainer.id}/`)).toBe(true)
      }

      // Edges reference new IDs, not original ones
      for (const edge of pastedEdges) {
        expect(existingIds.has(edge.source)).toBe(false)
        expect(existingIds.has(edge.target)).toBe(false)
      }
    })
  })

  describe('undo restores children across scope boundaries', () => {
    it('full node state includes children even when at root scope', () => {
      const { nodes, edges } = createContainerGraph()

      // This models what graphRef.current provides vs what ReactFlow sees
      const fullNodes = nodes
      const displayedAtRoot = getDisplayedNodes(nodes, '/')

      // The undo system must snapshot fullNodes, not displayedAtRoot
      expect(fullNodes.length).toBe(6)
      expect(displayedAtRoot.length).toBe(3)

      // After deleting /container at root scope...
      const deleteIds = new Set(['/container'])
      expandDeleteSet(deleteIds, fullNodes)
      const nodesAfterDelete = fullNodes.filter(n => !deleteIds.has(n.id))

      // The "before" snapshot must include children for undo to work
      const nodesBefore = [...fullNodes]
      const nodesAfter = [...nodesAfterDelete]

      // Undo: compute what needs to be added back
      const afterIds = new Set(nodesAfter.map(n => n.id))
      const nodesToRestore = nodesBefore.filter(n => !afterIds.has(n.id))

      // All container nodes must be restored, not just the container itself
      const restoredIds = nodesToRestore.map(n => n.id).sort()
      expect(restoredIds).toEqual([
        '/container',
        '/container/container-input',
        '/container/container-output',
        '/container/worker',
      ])
    })

    it('undo after nested container delete restores all descendants', () => {
      const { nodes } = createNestedContainerGraph()

      const fullNodes = [...nodes]
      const deleteIds = new Set(['/container'])
      expandDeleteSet(deleteIds, nodes)
      const nodesAfterDelete = nodes.filter(n => !deleteIds.has(n.id))

      // Undo diff
      const afterIds = new Set(nodesAfterDelete.map(n => n.id))
      const nodesToRestore = fullNodes.filter(n => !afterIds.has(n.id))

      const restoredIds = new Set(nodesToRestore.map(n => n.id))
      expect(restoredIds.has('/container')).toBe(true)
      expect(restoredIds.has('/container/nested')).toBe(true)
      expect(restoredIds.has('/container/nested/deep')).toBe(true)
      expect(restoredIds.has('/container/nested/container-input')).toBe(true)
      expect(restoredIds.has('/container/nested/container-output')).toBe(true)
    })

    it('undo restores edges that were removed by cascade', () => {
      const { nodes, edges } = createContainerGraph()

      const fullEdges = [...edges]
      const deleteIds = new Set(['/container'])
      expandDeleteSet(deleteIds, nodes)
      const edgesAfterDelete = edges.filter(
        e => !deleteIds.has(e.source) && !deleteIds.has(e.target)
      )

      // Undo diff for edges
      const afterEdgeIds = new Set(edgesAfterDelete.map(e => e.id))
      const edgesToRestore = fullEdges.filter(e => !afterEdgeIds.has(e.id))

      // All edges touching the container or its children should be restored
      expect(edgesToRestore.length).toBeGreaterThan(0)
      const restoredEdgeEndpoints = new Set(
        edgesToRestore.flatMap(e => [e.source, e.target])
      )
      expect(restoredEdgeEndpoints.has('/container')).toBe(true)
    })
  })

  describe('invariant: no orphaned children after any operation', () => {
    it('every path-based child has its parent in the graph after delete', () => {
      const { nodes } = createNestedContainerGraph()

      // Delete just the outer container
      const deleteIds = new Set(['/container'])
      expandDeleteSet(deleteIds, nodes)
      const remaining = nodes.filter(n => !deleteIds.has(n.id))

      // Invariant: every remaining node with a path parent must have that parent present
      for (const node of remaining) {
        const pathParent = getParentPath(node.id)
        if (pathParent && pathParent !== '/') {
          const parentExists = remaining.some(n => n.id === pathParent)
          expect(parentExists).toBe(true)
        }
      }
    })

    it('every path-based child has its parent in the graph after paste', () => {
      const { nodes, edges } = createNestedContainerGraph()
      transformGraph({ nodes, edges })

      const containerNode = nodes.find(n => n.id === '/container')!
      const { additionalNodes, additionalEdges } = collectContainerChildren(
        [containerNode],
        nodes,
        edges
      )

      const nodesToPaste = [containerNode, ...additionalNodes]
      const existingIds = new Set(nodes.map(n => n.id))

      const { nodes: pastedNodes } = remapPastedIds(
        nodesToPaste,
        additionalEdges,
        undefined,
        existingIds
      )

      // Invariant: every pasted node with a path parent must have that parent in pastedNodes
      const pastedIds = new Set(pastedNodes.map(n => n.id))
      for (const node of pastedNodes) {
        const pathParent = getParentPath(node.id)
        if (pathParent && pathParent !== '/') {
          expect(pastedIds.has(pathParent)).toBe(true)
        }
      }
    })
  })
})
