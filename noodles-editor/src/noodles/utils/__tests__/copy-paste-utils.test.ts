import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearOps } from '../../store'
import { transformGraph } from '../../transform-graph'
import '../../operators'
import {
  collectContainerChildren,
  identifyContainerChildren,
  remapPastedIds,
  sortParentsFirst,
  uniqueNodeId,
} from '../copy-paste-utils'

vi.mock('../../globals', () => ({
  projectId: 'test-project',
  safeMode: false,
  IS_PROD: false,
  DEFAULT_LATITUDE: 40.7128,
  DEFAULT_LONGITUDE: -74.006,
}))

function makeNode(id: string, type = 'NumberOp', parentId?: string) {
  return { id, type, position: { x: 0, y: 0 }, data: { inputs: {} }, parentId }
}

function makeEdge(source: string, sourceHandle: string, target: string, targetHandle: string) {
  return {
    id: `${source}.${sourceHandle}->${target}.${targetHandle}`,
    source,
    target,
    sourceHandle,
    targetHandle,
  }
}

describe('copy-paste-utils', () => {
  beforeEach(() => clearOps())
  afterEach(() => clearOps())

  describe('collectContainerChildren', () => {
    it('finds children by path prefix, not parentId', () => {
      const container = makeNode('/container', 'ContainerOp')
      const child1 = makeNode('/container/child1', 'NumberOp')
      const child2 = makeNode('/container/child2', 'MathOp')
      const unrelated = makeNode('/other', 'NumberOp')

      const allNodes = [container, child1, child2, unrelated]
      const allEdges = [makeEdge('/container', 'par.in', '/container/child1', 'par.parentValue')]

      const { additionalNodes, additionalEdges } = collectContainerChildren(
        [container],
        allNodes,
        allEdges
      )

      expect(additionalNodes).toHaveLength(2)
      expect(additionalNodes.map(n => n.id).sort()).toEqual([
        '/container/child1',
        '/container/child2',
      ])
      expect(additionalEdges).toHaveLength(1)
    })

    it('does not include nodes that merely share a prefix', () => {
      const container = makeNode('/con', 'ContainerOp')
      const notChild = makeNode('/container-other/child', 'NumberOp')

      const { additionalNodes } = collectContainerChildren([container], [container, notChild], [])

      expect(additionalNodes).toHaveLength(0)
    })

    it('only collects edges where both endpoints are in the container', () => {
      const container = makeNode('/container', 'ContainerOp')
      const child = makeNode('/container/child', 'NumberOp')
      const external = makeNode('/external', 'NumberOp')

      const internalEdge = makeEdge('/container', 'par.in', '/container/child', 'par.parentValue')
      const externalEdge = makeEdge('/container/child', 'out.val', '/external', 'par.a')

      const { additionalEdges } = collectContainerChildren(
        [container],
        [container, child, external],
        [internalEdge, externalEdge]
      )

      expect(additionalEdges).toHaveLength(1)
      expect(additionalEdges[0].id).toBe(internalEdge.id)
    })

    it('skips non-ContainerOp nodes', () => {
      const mathNode = makeNode('/math', 'MathOp')
      const wouldBeChild = makeNode('/math/child', 'NumberOp')

      const { additionalNodes } = collectContainerChildren([mathNode], [mathNode, wouldBeChild], [])

      expect(additionalNodes).toHaveLength(0)
    })

    it('recursively collects nested container children', () => {
      const outer = makeNode('/container', 'ContainerOp')
      const nested = makeNode('/container/nested', 'ContainerOp')
      const nestedInput = makeNode('/container/nested/container-input', 'GraphInputOp')
      const nestedOutput = makeNode('/container/nested/container-output', 'GraphOutputOp')
      const deepChild = makeNode('/container/nested/deep', 'NumberOp')
      const directChild = makeNode('/container/child', 'NumberOp')

      const allNodes = [outer, nested, nestedInput, nestedOutput, deepChild, directChild]
      const nestedInEdge = makeEdge(
        '/container/nested',
        'par.in',
        '/container/nested/container-input',
        'par.parentValue'
      )
      const allEdges = [nestedInEdge]

      const { additionalNodes, additionalEdges } = collectContainerChildren(
        [outer],
        allNodes,
        allEdges
      )

      const ids = additionalNodes.map(n => n.id).sort()
      expect(ids).toEqual([
        '/container/child',
        '/container/nested',
        '/container/nested/container-input',
        '/container/nested/container-output',
        '/container/nested/deep',
      ])
      expect(additionalEdges).toHaveLength(1)
    })
  })

  describe('sortParentsFirst', () => {
    it('sorts containers before their path-based children', () => {
      const nodes = [
        makeNode('/container/child', 'NumberOp'),
        makeNode('/container', 'ContainerOp'),
      ]

      const sorted = sortParentsFirst(nodes)
      expect(sorted[0].id).toBe('/container')
      expect(sorted[1].id).toBe('/container/child')
    })

    it('sorts group nodes before parentId-based children', () => {
      const nodes = [
        makeNode('/forloop-body-child', 'NumberOp', '/forloop-body'),
        makeNode('/forloop-body', 'group'),
      ]

      const sorted = sortParentsFirst(nodes)
      expect(sorted[0].id).toBe('/forloop-body')
      expect(sorted[1].id).toBe('/forloop-body-child')
    })

    it('handles nested containers (direct parent before child)', () => {
      const nodes = [
        makeNode('/a/b/deep', 'NumberOp'),
        makeNode('/a/b', 'ContainerOp'),
        makeNode('/a', 'ContainerOp'),
      ]

      const sorted = sortParentsFirst(nodes)
      const indexOf = (id: string) => sorted.findIndex(n => n.id === id)

      // Each direct parent appears before its direct child
      expect(indexOf('/a')).toBeLessThan(indexOf('/a/b'))
      expect(indexOf('/a/b')).toBeLessThan(indexOf('/a/b/deep'))
    })
  })

  describe('remapPastedIds', () => {
    it('namespaces container children under the new container ID', () => {
      const nodes = [
        makeNode('/container', 'ContainerOp'),
        makeNode('/container/container-input', 'GraphInputOp'),
        makeNode('/container/container-output', 'GraphOutputOp'),
        makeNode('/container/child', 'NumberOp'),
      ]
      const edges = [
        makeEdge('/container', 'par.in', '/container/container-input', 'par.parentValue'),
        makeEdge('/container/container-output', 'out.propagatedValue', '/container', 'out.out'),
      ]

      // Register operators so nodeId() checks pass
      transformGraph({ nodes, edges })

      const existing = new Set(nodes.map(n => n.id))
      const {
        nodes: pasted,
        edges: pastedEdges,
        idMap,
      } = remapPastedIds(nodes, edges, undefined, existing)

      // Container got a new ID
      const newContainer = pasted.find(n => n.type === 'ContainerOp')!
      expect(newContainer.id).not.toBe('/container')

      // Children are namespaced under the new container
      const children = pasted.filter(n => n.id !== newContainer.id)
      for (const child of children) {
        expect(child.id.startsWith(`${newContainer.id}/`)).toBe(true)
      }

      // Edges reference the new IDs
      for (const edge of pastedEdges) {
        expect(existing.has(edge.source)).toBe(false)
        expect(existing.has(edge.target)).toBe(false)
      }
    })

    it('does not namespace ForLoop group children under the group', () => {
      const nodes = [
        makeNode('/forloop-body', 'group'),
        makeNode('/forloop-begin', 'ForLoopBeginOp', '/forloop-body'),
        makeNode('/forloop-end', 'ForLoopEndOp', '/forloop-body'),
      ]
      const edges = [makeEdge('/forloop-begin', 'out.item', '/forloop-end', 'par.item')]

      transformGraph({ nodes, edges })

      const existing = new Set(nodes.map(n => n.id))
      const { nodes: pasted } = remapPastedIds(nodes, edges, undefined, existing)

      const group = pasted.find(n => n.type === 'group')!
      const children = pasted.filter(n => n.parentId === group.id)

      // Children should be at root level (siblings), not namespaced under group
      for (const child of children) {
        expect(child.id.startsWith(`${group.id}/`)).toBe(false)
        expect(child.id.startsWith('/')).toBe(true)
      }
    })

    it('remaps edges to use new node IDs', () => {
      const nodes = [makeNode('/a', 'NumberOp'), makeNode('/b', 'MathOp')]
      const edges = [makeEdge('/a', 'out.val', '/b', 'par.a')]

      transformGraph({ nodes, edges })

      const existing = new Set(nodes.map(n => n.id))
      const {
        nodes: pasted,
        edges: pastedEdges,
        idMap,
      } = remapPastedIds(nodes, edges, undefined, existing)

      expect(pastedEdges).toHaveLength(1)
      expect(pastedEdges[0].source).toBe(idMap.get('/a'))
      expect(pastedEdges[0].target).toBe(idMap.get('/b'))
      expect(pastedEdges[0].id).toContain(idMap.get('/a')!)
    })

    it('respects currentContainerId for top-level nodes', () => {
      const nodes = [makeNode('/num', 'NumberOp')]
      const edges: ReturnType<typeof makeEdge>[] = []

      // Create parent container in the store so the namespace exists
      const parentNodes = [
        makeNode('/parent', 'ContainerOp'),
        makeNode('/parent/container-input', 'GraphInputOp'),
        makeNode('/parent/container-output', 'GraphOutputOp'),
      ]
      const parentEdges = [
        makeEdge('/parent', 'par.in', '/parent/container-input', 'par.parentValue'),
        makeEdge('/parent/container-output', 'out.propagatedValue', '/parent', 'out.out'),
      ]
      transformGraph({ nodes: [...parentNodes, ...nodes], edges: [...parentEdges, ...edges] })

      const existing = new Set([...parentNodes, ...nodes].map(n => n.id))
      const { nodes: pasted } = remapPastedIds(nodes, edges, '/parent', existing)

      expect(pasted[0].id.startsWith('/parent/')).toBe(true)
    })
  })

  describe('identifyContainerChildren', () => {
    it('identifies path-based children that have no parentId', () => {
      const idMap = new Map([
        ['/container', '/container-1'],
        ['/container/child', '/container-1/child'],
      ])
      const copiedNodeIds = new Set(['/container', '/container/child'])

      const pastedNodes = [
        makeNode('/container-1', 'ContainerOp'),
        makeNode('/container-1/child', 'NumberOp'),
      ]

      const childIds = identifyContainerChildren(pastedNodes, idMap, copiedNodeIds)

      expect(childIds.has('/container-1/child')).toBe(true)
      expect(childIds.has('/container-1')).toBe(false)
    })

    it('does not identify nodes with parentId as container children', () => {
      const idMap = new Map([
        ['/group', '/group-1'],
        ['/child', '/child-1'],
      ])
      const copiedNodeIds = new Set(['/group', '/child'])

      const pastedNodes = [
        makeNode('/group-1', 'group'),
        makeNode('/child-1', 'NumberOp', '/group-1'),
      ]

      const childIds = identifyContainerChildren(pastedNodes, idMap, copiedNodeIds)

      expect(childIds.size).toBe(0)
    })
  })

  describe('uniqueNodeId', () => {
    it('returns base path when no conflict', () => {
      const result = uniqueNodeId('number', '/', new Set())
      expect(result).toBe('/number')
    })

    it('appends suffix when ID already exists', () => {
      transformGraph({ nodes: [makeNode('/number', 'NumberOp')], edges: [] })
      const existing = new Set(['/number'])

      const result = uniqueNodeId('number', '/', existing)
      expect(result).not.toBe('/number')
      expect(result).toMatch(/^\/number-\d+$/)
    })

    it('respects containerId for namespacing', () => {
      transformGraph({
        nodes: [
          makeNode('/parent', 'ContainerOp'),
          makeNode('/parent/container-input', 'GraphInputOp'),
          makeNode('/parent/container-output', 'GraphOutputOp'),
        ],
        edges: [
          makeEdge('/parent', 'par.in', '/parent/container-input', 'par.parentValue'),
          makeEdge('/parent/container-output', 'out.propagatedValue', '/parent', 'out.out'),
        ],
      })

      const result = uniqueNodeId('child', '/parent', new Set())
      expect(result).toBe('/parent/child')
    })
  })
})
