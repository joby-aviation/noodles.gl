import type { Node as ReactFlowNode } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getExecutor } from './graph-executor'
import type { Edge } from './noodles'
import {
  type CodeOp,
  type ConcatOp,
  type DeckRendererOp,
  type GeoJsonLayerOp,
  type IOperator,
  MathOp,
  NumberOp,
  type Operator,
} from './operators'
import { referenceDependencyModel } from './reference-dependencies'
import { clearOps, getOpStore, hasOp } from './store'
import { deriveReferenceEdges, transformGraph } from './transform-graph'
import { edgeId } from './utils/id-utils'

afterEach(() => {
  referenceDependencyModel.reset()
})

describe('transform-graph topological sort with missing upstream nodes', () => {
  afterEach(() => {
    clearOps()
  })

  it('instantiates a node whose only upstream source does not exist in the graph', () => {
    // Reproduces the KmlToGeoJsonOp bug: an edge references /file as source, but /file is not
    // in the nodes list. Without the fix, /kml-to-geo-json would be silently dropped from the
    // sorted output and never stored, causing "Operator with id X not found" at render time.
    const nodes = [
      {
        id: '/kml-to-geo-json',
        type: 'NumberOp', // operator type doesn't matter for this test
        data: { inputs: {} },
        position: { x: 0, y: 0 },
      },
    ]
    const edges = [
      {
        // /file does not exist in nodes — stale edge
        source: '/file',
        target: '/kml-to-geo-json',
        sourceHandle: 'out.data',
        targetHandle: 'par.val',
        id: '/file.out.data->/kml-to-geo-json.par.val',
      },
    ]

    const result = transformGraph({ nodes, edges })

    expect(result.operators).toHaveLength(1)
    expect(result.operators[0].id).toBe('/kml-to-geo-json')
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].type).toBe('stale-edge')

    const { getOp } = getOpStore()
    expect(getOp('/kml-to-geo-json')).toBeDefined()
  })

  it('instantiates all nodes when multiple have missing upstream sources', () => {
    const nodes = [
      { id: '/a', type: 'NumberOp', data: { inputs: {} }, position: { x: 0, y: 0 } },
      { id: '/b', type: 'NumberOp', data: { inputs: {} }, position: { x: 0, y: 0 } },
    ]
    const edges = [
      // Both targets reference sources that don't exist
      {
        source: '/missing-1',
        target: '/a',
        sourceHandle: 'out.val',
        targetHandle: 'par.val',
        id: '/missing-1.out.val->/a.par.val',
      },
      {
        source: '/missing-2',
        target: '/b',
        sourceHandle: 'out.val',
        targetHandle: 'par.val',
        id: '/missing-2.out.val->/b.par.val',
      },
    ]

    const result = transformGraph({ nodes, edges })

    expect(result.operators).toHaveLength(2)
    const { getOp } = getOpStore()
    expect(getOp('/a')).toBeDefined()
    expect(getOp('/b')).toBeDefined()
  })

  it('correctly orders reachable nodes before unreachable ones', () => {
    // /source -> /downstream (reachable), /orphan has stale incoming edge from /ghost (unreachable)
    const nodes = [
      { id: '/source', type: 'NumberOp', data: { inputs: { val: 1 } }, position: { x: 0, y: 0 } },
      {
        id: '/downstream',
        type: 'MathOp',
        data: { inputs: { operator: 'add', b: 0 } },
        position: { x: 0, y: 0 },
      },
      { id: '/orphan', type: 'NumberOp', data: { inputs: {} }, position: { x: 0, y: 0 } },
    ]
    const edges = [
      {
        source: '/source',
        target: '/downstream',
        sourceHandle: 'out.val',
        targetHandle: 'par.a',
        id: '/source.out.val->/downstream.par.a',
      },
      {
        source: '/ghost', // doesn't exist
        target: '/orphan',
        sourceHandle: 'out.val',
        targetHandle: 'par.val',
        id: '/ghost.out.val->/orphan.par.val',
      },
    ]

    const result = transformGraph({ nodes, edges })

    expect(result.operators).toHaveLength(3)
    // /source must come before /downstream in execution order
    const ids = result.operators.map(op => op.id)
    expect(ids.indexOf('/source')).toBeLessThan(ids.indexOf('/downstream'))
    // /orphan must also be present
    expect(ids).toContain('/orphan')
  })

  it('still works correctly when all nodes are reachable (no regression)', () => {
    const nodes = [
      { id: '/num', type: 'NumberOp', data: { inputs: { val: 5 } }, position: { x: 0, y: 0 } },
      { id: '/math', type: 'MathOp', data: { inputs: { b: 3 } }, position: { x: 0, y: 0 } },
    ]
    const edges = [
      {
        source: '/num',
        target: '/math',
        sourceHandle: 'out.val',
        targetHandle: 'par.a',
        id: '/num.out.val->/math.par.a',
      },
    ]

    const result = transformGraph({ nodes, edges })

    expect(result.operators).toHaveLength(2)
    const ids = result.operators.map(op => op.id)
    expect(ids.indexOf('/num')).toBeLessThan(ids.indexOf('/math'))
  })
})

describe('vector channel handles', () => {
  afterEach(() => clearOps())

  it('connects an individual channel and preserves the editable sibling', () => {
    const nodes = [
      {
        id: '/number',
        type: 'NumberOp',
        data: { inputs: {} },
        position: { x: 0, y: 0 },
      },
      {
        id: '/map',
        type: 'MapViewStateOp',
        data: {
          inputs: { center: { lng: 1, lat: 5 } },
          inputPortModes: { center: 'channels' },
        },
        position: { x: 100, y: 0 },
      },
    ]
    const edges = [
      {
        id: '/number.out.val->/map.par.center.lng',
        source: '/number',
        target: '/map',
        sourceHandle: 'out.val',
        targetHandle: 'par.center.lng',
      },
    ]

    transformGraph({ nodes, edges })
    const number = getOpStore().getOp('/number')!
    const map = getOpStore().getOp('/map')!
    number.outputs.val.next(25)

    expect(map.inputs.center.value).toEqual({ lng: 25, lat: 5 })
    expect(map.getInputPortMode('center')).toBe('channels')
  })

  it('cleans up removed channel connections', () => {
    const nodes = [
      {
        id: '/number',
        type: 'NumberOp',
        data: { inputs: {} },
        position: { x: 0, y: 0 },
      },
      {
        id: '/map',
        type: 'MapViewStateOp',
        data: {
          inputs: { center: { lng: 1, lat: 5 } },
          inputPortModes: { center: 'channels' },
        },
        position: { x: 100, y: 0 },
      },
    ]
    const edge = {
      id: '/number.out.val->/map.par.center.lng',
      source: '/number',
      target: '/map',
      sourceHandle: 'out.val',
      targetHandle: 'par.center.lng',
    }

    transformGraph({ nodes, edges: [edge] })
    const number = getOpStore().getOp('/number')!
    const map = getOpStore().getOp('/map')!
    transformGraph({ nodes, edges: [] })
    const disconnectedValue = map.inputs.center.value

    number.outputs.val.next(50)

    expect(map.inputs.center.channelFields.lng.subscriptions.has(edge.id)).toBe(false)
    expect(map.inputs.center.value).toEqual(disconnectedValue)
  })

  it('cleans up channel subscriptions when the owning operator is removed', () => {
    const numberNode = {
      id: '/number',
      type: 'NumberOp',
      data: { inputs: {} },
      position: { x: 0, y: 0 },
    }
    const mapNode = {
      id: '/map',
      type: 'MapViewStateOp',
      data: {
        inputs: { center: { lng: 1, lat: 5 } },
        inputPortModes: { center: 'channels' },
      },
      position: { x: 100, y: 0 },
    }
    const edge = {
      id: '/number.out.val->/map.par.center.lng',
      source: '/number',
      target: '/map',
      sourceHandle: 'out.val',
      targetHandle: 'par.center.lng',
    }

    transformGraph({ nodes: [numberNode, mapNode], edges: [edge] })
    const map = getOpStore().getOp('/map')!
    const center = map.inputs.center

    transformGraph({ nodes: [numberNode], edges: [] })

    expect(center.subscriptions.size).toBe(0)
    expect(center.channelFields.lng.subscriptions.size).toBe(0)
    expect(center.channelFields.lat.subscriptions.size).toBe(0)
  })

  it('does not attach a whole-value edge while channel ports are active', () => {
    const nodes = [
      {
        id: '/point',
        type: 'PointOp',
        data: { inputs: { coordinates: { lng: 20, lat: 30 } } },
        position: { x: 0, y: 0 },
      },
      {
        id: '/map',
        type: 'MapViewStateOp',
        data: {
          inputs: { center: { lng: 1, lat: 5 } },
          inputPortModes: { center: 'channels' },
        },
        position: { x: 100, y: 0 },
      },
    ]
    const edges = [
      {
        id: '/point.out.feature->/map.par.center',
        source: '/point',
        target: '/map',
        sourceHandle: 'out.feature',
        targetHandle: 'par.center',
      },
    ]

    transformGraph({ nodes, edges })
    const map = getOpStore().getOp('/map')!

    expect(map.inputs.center.value).toEqual({ lng: 1, lat: 5 })
    expect(map.connectionErrors.value.get(edges[0].id)).toContain('Inactive center port')
  })

  it('keeps legacy MapViewState parameter references reactive', () => {
    const nodes = [
      {
        id: '/map',
        type: 'MapViewStateOp',
        data: { inputs: { center: { lng: 1, lat: 5 } } },
        position: { x: 0, y: 0 },
      },
      {
        id: '/code',
        type: 'CodeOp',
        data: { inputs: { code: "return op('/map').par.longitude" } },
        position: { x: 100, y: 0 },
      },
    ]

    transformGraph({ nodes, edges: [] })
    const map = getOpStore().getOp('/map')!
    const code = getOpStore().getOp('/code') as CodeOp
    let emissions = 0
    const subscription = code.inputs.code.subscribe(() => emissions++)
    const initialEmissions = emissions

    map.inputs.center.setValue({ lng: 25, lat: 5 })

    expect(referenceDependencyModel.getSnapshot()[0].sourceHandle).toBe('par.longitude')
    expect(emissions).toBe(initialEmissions + 1)
    subscription.unsubscribe()
  })
})

describe('transform-graph stale edge and unknown type warnings', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    errorSpy.mockRestore()
    clearOps()
  })

  it('errors when an edge source node does not exist', () => {
    const nodes = [{ id: '/b', type: 'NumberOp', data: { inputs: {} }, position: { x: 0, y: 0 } }]
    const edges = [
      {
        source: '/missing',
        target: '/b',
        sourceHandle: 'out.val',
        targetHandle: 'par.val',
        id: '/missing.out.val->/b.par.val',
      },
    ]

    transformGraph({ nodes, edges })

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Stale edge detected'))
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('"/missing"'))
  })

  it('errors when an edge target node does not exist', () => {
    const nodes = [{ id: '/a', type: 'NumberOp', data: { inputs: {} }, position: { x: 0, y: 0 } }]
    const edges = [
      {
        source: '/a',
        target: '/missing',
        sourceHandle: 'out.val',
        targetHandle: 'par.val',
        id: '/a.out.val->/missing.par.val',
      },
    ]

    transformGraph({ nodes, edges })

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Stale edge detected'))
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('"/missing"'))
  })

  it('emits one error per stale edge', () => {
    const nodes = [{ id: '/b', type: 'NumberOp', data: { inputs: {} }, position: { x: 0, y: 0 } }]
    const edges = [
      {
        source: '/ghost-1',
        target: '/b',
        sourceHandle: 'out.val',
        targetHandle: 'par.val',
        id: '/ghost-1.out.val->/b.par.val',
      },
      {
        source: '/ghost-2',
        target: '/b',
        sourceHandle: 'out.val',
        targetHandle: 'par.val',
        id: '/ghost-2.out.val->/b.par.val',
      },
    ]

    transformGraph({ nodes, edges })

    const staleErrors = errorSpy.mock.calls.filter(call =>
      String(call[0]).includes('Stale edge detected')
    )
    expect(staleErrors).toHaveLength(2)
  })

  it('does not error for a clean graph with no stale edges', () => {
    const nodes = [
      { id: '/a', type: 'NumberOp', data: { inputs: { val: 1 } }, position: { x: 0, y: 0 } },
      {
        id: '/b',
        type: 'MathOp',
        data: { inputs: { operator: 'add', b: 0 } },
        position: { x: 0, y: 0 },
      },
    ]
    const edges = [
      {
        source: '/a',
        target: '/b',
        sourceHandle: 'out.val',
        targetHandle: 'par.a',
        id: '/a.out.val->/b.par.a',
      },
    ]

    transformGraph({ nodes, edges })

    const staleErrors = errorSpy.mock.calls.filter(call =>
      String(call[0]).includes('Stale edge detected')
    )
    expect(staleErrors).toHaveLength(0)
  })

  it('errors about unknown operator types', () => {
    const nodes = [
      { id: '/unknown-op', type: 'NonExistentOp', data: { inputs: {} }, position: { x: 0, y: 0 } },
    ]

    transformGraph({ nodes, edges: [] })

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown operator type'))
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('"NonExistentOp"'))
  })

  it('does not error for "group" special node type (React Flow group nodes)', () => {
    const nodes = [
      { id: 'for-loop-scope', type: 'group', data: {}, position: { x: 0, y: 0 } },
      { id: '/num', type: 'NumberOp', data: { inputs: {} }, position: { x: 0, y: 0 } },
    ]

    transformGraph({ nodes, edges: [] })

    const unknownTypeErrors = errorSpy.mock.calls.filter(call =>
      String(call[0]).includes('Unknown operator type')
    )
    expect(unknownTypeErrors).toHaveLength(0)
  })

  it('passes visual group definitions to the executor for nested loop pairing', () => {
    const nodes = [
      {
        id: '/outer-body',
        type: 'group',
        data: {},
        position: { x: 0, y: 0 },
      },
      {
        id: '/outer-begin',
        type: 'ForLoopBeginOp',
        data: { inputs: {} },
        position: { x: 0, y: 0 },
        parentId: '/outer-body',
      },
      {
        id: '/outer-end',
        type: 'ForLoopEndOp',
        data: { inputs: {} },
        position: { x: 900, y: 0 },
        parentId: '/outer-body',
      },
      {
        id: '/inner-body',
        type: 'group',
        data: {},
        position: { x: 300, y: 100 },
      },
      {
        id: '/inner-begin',
        type: 'ForLoopBeginOp',
        data: { inputs: {} },
        position: { x: 0, y: 0 },
        parentId: '/inner-body',
      },
      {
        id: '/inner-end',
        type: 'ForLoopEndOp',
        data: { inputs: {} },
        position: { x: 300, y: 0 },
        parentId: '/inner-body',
      },
    ]
    const edges = [
      {
        id: '/outer-begin.out.item->/inner-begin.par.data',
        source: '/outer-begin',
        target: '/inner-begin',
        sourceHandle: 'out.item',
        targetHandle: 'par.data',
      },
      {
        id: '/inner-begin.out.item->/inner-end.par.item',
        source: '/inner-begin',
        target: '/inner-end',
        sourceHandle: 'out.item',
        targetHandle: 'par.item',
      },
      {
        id: '/inner-end.out.data->/outer-end.par.item',
        source: '/inner-end',
        target: '/outer-end',
        sourceHandle: 'out.data',
        targetHandle: 'par.item',
      },
    ]

    transformGraph({ nodes, edges })

    const scopes = getExecutor()!.findForLoopScopes()
    const outerScope = scopes.find(scope => scope.beginOp.id === '/outer-begin')!
    const innerScope = scopes.find(scope => scope.beginOp.id === '/inner-begin')!
    expect(outerScope.endOp.id).toBe('/outer-end')
    expect(innerScope.endOp.id).toBe('/inner-end')
  })

  it('sets a connection error on the target operator when source node is missing', () => {
    const nodes = [{ id: '/b', type: 'NumberOp', data: { inputs: {} }, position: { x: 0, y: 0 } }]
    const edges = [
      {
        source: '/missing',
        target: '/b',
        sourceHandle: 'out.val',
        targetHandle: 'par.val',
        id: '/missing.out.val->/b.par.val',
      },
    ]

    transformGraph({ nodes, edges })

    const { getOp } = getOpStore()
    const op = getOp('/b') as NumberOp
    expect(op.hasConnectionErrors()).toBe(true)
    const msgs = op.getConnectionErrorMessages()
    expect(msgs[0]).toContain('Broken connection')
    expect(msgs[0]).toContain('"/missing"')
  })

  it('clears the broken-connection error when the stale edge is removed', () => {
    const nodes = [{ id: '/b', type: 'NumberOp', data: { inputs: {} }, position: { x: 0, y: 0 } }]
    const edges = [
      {
        source: '/missing',
        target: '/b',
        sourceHandle: 'out.val',
        targetHandle: 'par.val',
        id: '/missing.out.val->/b.par.val',
      },
    ]

    transformGraph({ nodes, edges })

    // Confirm error is set
    const { getOp } = getOpStore()
    expect(getOp('/b')!.hasConnectionErrors()).toBe(true)

    // Remove the stale edge
    transformGraph({ nodes, edges: [] })

    expect(getOp('/b')!.hasConnectionErrors()).toBe(false)
  })

  it('does not fire stale-edge error for edges to unknown-type nodes', () => {
    // An edge connecting to a node with an unknown type should only fire the "Unknown operator
    // type" error, not a second "Stale edge detected" error for the same missing node ID.
    const nodes = [
      { id: '/a', type: 'NumberOp', data: { inputs: {} }, position: { x: 0, y: 0 } },
      { id: '/b', type: 'NonExistentOp', data: { inputs: {} }, position: { x: 0, y: 0 } },
    ]
    const edges = [
      {
        source: '/a',
        target: '/b',
        sourceHandle: 'out.val',
        targetHandle: 'par.val',
        id: '/a.out.val->/b.par.val',
      },
    ]

    transformGraph({ nodes, edges })

    const staleErrors = errorSpy.mock.calls.filter(call =>
      String(call[0]).includes('Stale edge detected')
    )
    expect(staleErrors).toHaveLength(0)
    // The unknown-type error should still fire
    const unknownTypeErrors = errorSpy.mock.calls.filter(call =>
      String(call[0]).includes('Unknown operator type')
    )
    expect(unknownTypeErrors).toHaveLength(1)
  })
})

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

    const result = transformGraph(graph)
    expect(result.operators).toHaveLength(2)

    const [num, add] = result.operators
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

  it('ignores legacy ReferenceEdges that are not backed by a field reference', () => {
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

    const result = transformGraph(graph)
    expect(result.operators).toHaveLength(2)

    const num = result.operators.find(op => op.id === '/num')!
    const add = result.operators.find(op => op.id === '/add') as MathOp
    expect(num).toBeInstanceOf(NumberOp)
    expect(add).toBeInstanceOf(MathOp)

    // The field text is authoritative; ephemeral editor edges are not graph input.
    expect(add.inputs.a.subscriptions.has('/num.out.val->/add.par.a')).toBe(false)
  })

  it('does not report type mismatch errors for ReferenceEdges', () => {
    // NumberOp (number) referenced by CodeOp.par.code (CodeField/string) — should be error-free
    const graph: {
      nodes: ReactFlowNode<Record<string, unknown>>[]
      edges: (Edge<Operator<IOperator>, Operator<IOperator>> & { type?: string })[]
    } = {
      nodes: [
        { id: '/num', type: 'NumberOp', data: { inputs: { val: 5 } }, position: { x: 0, y: 0 } },
        {
          id: '/code',
          type: 'CodeOp',
          data: { inputs: { code: 'return op("/num").out.val' } },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [
        {
          id: '/num.out.val->/code.par.code',
          type: 'ReferenceEdge',
          source: '/num',
          target: '/code',
          sourceHandle: 'out.val',
          targetHandle: 'par.code',
        } as Edge<Operator<IOperator>, Operator<IOperator>> & { type: string },
      ],
    }

    const result = transformGraph(graph)
    const code = result.operators.find(op => op.id === '/code') as CodeOp
    expect(code.hasConnectionErrors()).toBe(false)
  })

  it('still reports type mismatch errors for regular value edges', () => {
    // Same operators and fields, but as a plain value edge — should still produce an error
    const graph: {
      nodes: ReactFlowNode<Record<string, unknown>>[]
      edges: Edge<Operator<IOperator>, Operator<IOperator>>[]
    } = {
      nodes: [
        { id: '/num', type: 'NumberOp', data: { inputs: { val: 5 } }, position: { x: 0, y: 0 } },
        {
          id: '/code',
          type: 'CodeOp',
          data: { inputs: { code: '' } },
          position: { x: 0, y: 0 },
        },
      ],
      edges: [
        {
          id: '/num.out.val->/code.par.code',
          source: '/num',
          target: '/code',
          sourceHandle: 'out.val',
          targetHandle: 'par.code',
        },
      ],
    }

    const result = transformGraph(graph)
    const code = result.operators.find(op => op.id === '/code') as CodeOp
    expect(code.hasConnectionErrors()).toBe(true)
    const errorMessage = code.connectionErrors.value.get('/num.out.val->/code.par.code')
    expect(errorMessage).toContain('Type mismatch')
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

    const result = transformGraph(graph)
    const add = result.operators.find(op => op.id === '/add') as MathOp

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

    const result = transformGraph(graphWithValidConnection)
    const add = result.operators.find(op => op.id === '/add') as MathOp

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

    const result = transformGraph(graphWithoutConnection)
    const add = result.operators.find(op => op.id === '/add') as MathOp

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

      const { getOp } = getOpStore()
      const op = getOp('/deck-0')
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

      const { getOp } = getOpStore()
      const op = getOp('/deck-0')
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

      const { getOp } = getOpStore()
      const op = getOp('/geojson-0') as GeoJsonLayerOp
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

      const { getOp } = getOpStore()
      const op = getOp('/geojson-0') as GeoJsonLayerOp
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

      const { getOp } = getOpStore()
      const op = getOp('/deck-0')
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

      const { getOp } = getOpStore()
      const op = getOp('/deck-0')
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

      const { getOp } = getOpStore()
      const op = getOp('/num-0')
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

      const { getOp } = getOpStore()
      const op = getOp('/deck-0')
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

      const { getOp } = getOpStore()
      const op = getOp('/deck-0')
      expect(op).toBeDefined()

      // ReferenceEdges should not trigger auto-show
      // visibleFields should remain null (using defaults)
      expect(op!.visibleFields.value).toBe(null)
      // 'effects' should still be hidden
      expect(op!.isFieldVisible('effects')).toBe(false)
    })
  })
})

// Tests for the fix: skip connection errors when source field value is undefined.
// Background: the graphStructureKey optimization means transformGraph only runs on structural
// changes. On initial project load, operators haven't executed yet, so output fields with
// `defaultValue = undefined` (e.g. LayerField) have no value. Previously, React Flow dimension
// change events would re-run transformGraph after ops had executed (clearing the false error).
// Now it doesn't, so we must skip validation when the source value is undefined.
describe('connection error suppression for undefined source fields', () => {
  afterEach(() => {
    clearOps()
  })

  it('no false type mismatch for valid layer→list connection when op has not yet executed', () => {
    // ScatterplotLayerOp.out.layer (LayerField, defaultValue=undefined) → DeckRendererOp.par.layers
    // This is a valid connection. LayerField starts with undefined (no defaultValue), and
    // createListeners() executes async, so at transformGraph time the value is still undefined.
    const nodes = [
      {
        id: '/scatter',
        type: 'ScatterplotLayerOp',
        data: { inputs: {} },
        position: { x: 0, y: 0 },
      },
      {
        id: '/deck',
        type: 'DeckRendererOp',
        data: { inputs: {} },
        position: { x: 100, y: 0 },
      },
    ]
    const edges = [
      {
        id: '/scatter.out.layer->/deck.par.layers',
        source: '/scatter',
        target: '/deck',
        sourceHandle: 'out.layer',
        targetHandle: 'par.layers',
      },
    ]

    const result = transformGraph({ nodes, edges })
    const deck = result.operators.find(op => op.id === '/deck') as DeckRendererOp

    expect(deck.hasConnectionErrors()).toBe(false)
  })

  it('no false type mismatch for incompatible connection when source has not yet executed', () => {
    // Even a genuinely incompatible connection (layer→number) should not produce an error
    // when the source field value is undefined, since we cannot confirm incompatibility yet.
    // LayerField.defaultValue = undefined; execution is async via createListeners().
    const nodes = [
      {
        id: '/scatter',
        type: 'ScatterplotLayerOp',
        data: { inputs: {} },
        position: { x: 0, y: 0 },
      },
      {
        id: '/add',
        type: 'MathOp',
        data: { inputs: { operator: 'add', b: 0 } },
        position: { x: 100, y: 0 },
      },
    ]
    const edges = [
      {
        id: '/scatter.out.layer->/add.par.a',
        source: '/scatter',
        target: '/add',
        sourceHandle: 'out.layer',
        targetHandle: 'par.a',
      },
    ]

    const result = transformGraph({ nodes, edges })
    const add = result.operators.find(op => op.id === '/add') as MathOp

    expect(add.hasConnectionErrors()).toBe(false)
  })

  it('real type mismatch IS detected when source field has a defined default value', () => {
    // StringField has static defaultValue = '' which is set synchronously in the Field
    // constructor, so the output value is non-undefined even before execution.
    // Connecting a string output to a number input should still produce an error.
    const nodes = [
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
        position: { x: 100, y: 0 },
      },
    ]
    const edges = [
      {
        id: '/str.out.val->/add.par.a',
        source: '/str',
        target: '/add',
        sourceHandle: 'out.val',
        targetHandle: 'par.a',
      },
    ]

    const result = transformGraph({ nodes, edges })
    const add = result.operators.find(op => op.id === '/add') as MathOp

    expect(add.hasConnectionErrors()).toBe(true)
    expect(add.connectionErrors.value.get('/str.out.val->/add.par.a')).toContain('Type mismatch')
  })

  it('stale connection error is cleared when source value becomes undefined on re-run', () => {
    // If an error was set previously, and then the source field resets to undefined
    // (simulated via BehaviorSubject.next), the error should be cleared on the next
    // transformGraph run rather than being falsely preserved.
    const nodes = [
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
        position: { x: 100, y: 0 },
      },
    ]
    const edges = [
      {
        id: '/str.out.val->/add.par.a',
        source: '/str',
        target: '/add',
        sourceHandle: 'out.val',
        targetHandle: 'par.a',
      },
    ]

    // First run: StringOp has value 'hello' → type mismatch error set
    transformGraph({ nodes, edges })
    const { getOp } = getOpStore()
    const add = getOp('/add') as MathOp
    expect(add.hasConnectionErrors()).toBe(true)

    // Simulate source field resetting to undefined (e.g. operator disposed and recreated)
    // BehaviorSubject.next() sets the raw value, bypassing Field.setValue validation
    const str = getOp('/str')!
    str.outputs.val.next(undefined as unknown as string)

    // Second run: same structure, but source field now has undefined value
    transformGraph({ nodes, edges })

    // Error should be cleared — source has no value, so we cannot confirm the mismatch
    expect(add.hasConnectionErrors()).toBe(false)
  })
})

describe('GraphInputOp rebuildFromContainer keeps the container link alive', () => {
  afterEach(() => {
    clearOps()
  })

  it('still receives container.par.in updates after a custom-fields rebuild', () => {
    // rebuildFromContainer used to recreate the parentValue field object,
    // orphaning the container.par.in -> parentValue connection wired by
    // transformGraph. Data arriving after any rebuild (async FileOp upstream
    // of the container) then never reached the container's children.
    const nodes = [
      {
        id: '/box',
        type: 'ContainerOp',
        data: {
          inputs: {},
          customInputs: [
            { id: 'ci1', name: 'threshold', type: 'number', order: 0, defaultValue: 4 },
          ],
        },
        position: { x: 0, y: 0 },
      },
      { id: '/box/input', type: 'GraphInputOp', data: { inputs: {} }, position: { x: 10, y: 0 } },
    ]

    transformGraph({ nodes, edges: [] })

    const { getOp } = getOpStore()
    const box = getOp('/box')!
    const graphInput = getOp('/box/input')! as InstanceType<
      typeof import('./operators')['GraphInputOp']
    >

    box.inputs.in.setValue([1, 2, 3])
    expect(graphInput.inputs.parentValue.value).toEqual([1, 2, 3])

    // Simulate what the customFieldsChanged subscription does on any later
    // custom-field change.
    graphInput.rebuildFromContainer(box as never)

    box.inputs.in.setValue([4, 5, 6, 7])
    expect(graphInput.inputs.parentValue.value).toEqual([4, 5, 6, 7])
  })
})

describe('derived reference edges (unmounted nodes)', () => {
  afterEach(() => {
    clearOps()
  })

  it('wires an op() reference in a container child that has no persisted edge', () => {
    // The graph model derives dependencies without requiring a mounted editor,
    // including for collapsed container children.
    const nodes = [
      { id: '/num', type: 'NumberOp', data: { inputs: { val: 7 } }, position: { x: 0, y: 0 } },
      { id: '/box', type: 'ContainerOp', data: { inputs: {} }, position: { x: 100, y: 0 } },
      {
        id: '/box/child',
        type: 'CodeOp',
        data: { inputs: { code: "return op('/num').out.val * 2" } },
        position: { x: 110, y: 0 },
      },
    ]

    transformGraph({ nodes, edges: [] })

    const { getOp } = getOpStore()
    const child = getOp('/box/child')!
    const refEdgeId = '/num.out.val->/box/child.par.code'
    expect(child.inputs.code.subscriptions.has(refEdgeId)).toBe(true)
  })

  it('keeps an unmounted container child reactive through its derived reference', async () => {
    const nodes = [
      {
        id: '/source',
        type: 'NumberOp',
        data: { inputs: { val: 200 } },
        position: { x: 0, y: 0 },
      },
      { id: '/box', type: 'ContainerOp', data: { inputs: {} }, position: { x: 100, y: 0 } },
      {
        id: '/box/child',
        type: 'CodeOp',
        data: { inputs: { code: "return op('/source').out.val" } },
        position: { x: 110, y: 0 },
      },
      { id: '/viewer', type: 'ViewerOp', data: { inputs: {} }, position: { x: 200, y: 0 } },
    ]
    const edges = [
      {
        id: '/box/child.out.data->/viewer.par.data',
        source: '/box/child',
        target: '/viewer',
        sourceHandle: 'out.data',
        targetHandle: 'par.data',
      },
    ]

    transformGraph({ nodes, edges })
    await getExecutor()!.executeFrame(performance.now())

    const { getOp } = getOpStore()
    const source = getOp('/source') as NumberOp
    const viewer = getOp('/viewer')!
    expect(viewer.inputs.data.value).toBe(200)

    source.inputs.val.setValue(201)
    await getExecutor()!.executeFrame(performance.now())
    expect(viewer.inputs.data.value).toBe(201)
  })

  it('derives edges for array-form code and mustache references, skipping unresolvable ones', () => {
    const nodes = [
      { id: '/a', type: 'NumberOp', data: { inputs: { val: 1 } }, position: { x: 0, y: 0 } },
      {
        id: '/code',
        type: 'CodeOp',
        data: {
          inputs: {
            code: ["const x = op('/a').out.val", "const y = op('/gone').out.val", 'return x'],
          },
        },
        position: { x: 50, y: 0 },
      },
    ]
    const derived = deriveReferenceEdges(nodes, [])
    expect(derived).toHaveLength(1)
    expect(derived[0]).toMatchObject({
      id: '/a.out.val->/code.par.code',
      type: 'ReferenceEdge',
      source: '/a',
      sourceHandle: 'out.val',
      target: '/code',
      targetHandle: 'par.code',
    })
  })

  it('derives and watches dependencies from non-string field expression source', () => {
    const nodes = [
      { id: '/a', type: 'NumberOp', data: { inputs: { val: 1 } }, position: { x: 0, y: 0 } },
      { id: '/b', type: 'NumberOp', data: { inputs: { val: 2 } }, position: { x: 0, y: 50 } },
      {
        id: '/target',
        type: 'NumberOp',
        data: { inputs: { val: { $expr: "op('/a').par.val * 2" } } },
        position: { x: 100, y: 0 },
      },
    ]

    expect(deriveReferenceEdges(nodes, [])).toMatchObject([
      {
        id: '/a.par.val->/target.par.val',
        source: '/a',
        sourceHandle: 'par.val',
        target: '/target',
        targetHandle: 'par.val',
      },
    ])

    transformGraph({ nodes, edges: [] })

    const target = getOpStore().getOp('/target') as NumberOp
    const b = getOpStore().getOp('/b') as NumberOp
    expect(target.inputs.val.expression).toBe("op('/a').par.val * 2")
    expect(target.inputs.val.value).toBe(2)
    expect(getExecutor()!.getUpstream('/target')).toEqual(new Set(['/a']))

    target.inputs.val.setExpression("op('/b').par.val * 3")

    expect(referenceDependencyModel.getSnapshot().map(edge => edge.id)).toEqual([
      '/b.par.val->/target.par.val',
    ])
    expect(getExecutor()!.getUpstream('/target')).toEqual(new Set(['/b']))
    expect(target.inputs.val.value).toBe(6)

    b.inputs.val.setValue(4)
    expect(target.inputs.val.value).toBe(12)

    target.inputs.val.clearExpression()
    expect(referenceDependencyModel.getSnapshot()).toEqual([])
    expect(getExecutor()!.getUpstream('/target')).toEqual(new Set())
  })

  it('does not duplicate an existing equivalent edge', () => {
    const nodes = [
      { id: '/a', type: 'NumberOp', data: { inputs: { val: 1 } }, position: { x: 0, y: 0 } },
      {
        id: '/code',
        type: 'CodeOp',
        data: { inputs: { code: "return op('/a').out.val" } },
        position: { x: 50, y: 0 },
      },
    ]
    const existing = [
      {
        id: '/a.out.val->/code.par.code',
        type: 'ReferenceEdge',
        source: '/a',
        sourceHandle: 'out.val',
        target: '/code',
        targetHandle: 'par.code',
      },
    ]
    expect(deriveReferenceEdges(nodes, existing)).toHaveLength(0)
  })

  it('moves a live reference without a mounted CodeField component', () => {
    const nodes = [
      { id: '/a', type: 'NumberOp', data: { inputs: { val: 1 } }, position: { x: 0, y: 0 } },
      { id: '/b', type: 'NumberOp', data: { inputs: { val: 2 } }, position: { x: 0, y: 0 } },
      {
        id: '/code',
        type: 'CodeOp',
        data: { inputs: { code: "return op('/a').out.val" } },
        position: { x: 50, y: 0 },
      },
    ]

    transformGraph({ nodes, edges: [] })

    const code = getOpStore().getOp('/code') as CodeOp
    const b = getOpStore().getOp('/b') as NumberOp
    const executor = getExecutor()!
    const onProjectionChange = vi.fn()
    const unsubscribe = referenceDependencyModel.subscribe(onProjectionChange)
    expect(code.inputs.code.subscriptions.has('/a.out.val->/code.par.code')).toBe(true)
    expect(executor.getUpstream('/code')).toEqual(new Set(['/a']))
    expect(referenceDependencyModel.getSnapshot().map(edge => edge.id)).toEqual([
      '/a.out.val->/code.par.code',
    ])

    code.inputs.code.setValue("return op('/b').out.val")

    expect(code.inputs.code.subscriptions.has('/a.out.val->/code.par.code')).toBe(false)
    expect(code.inputs.code.subscriptions.has('/b.out.val->/code.par.code')).toBe(true)
    expect(executor.getUpstream('/code')).toEqual(new Set(['/b']))
    expect(referenceDependencyModel.getSnapshot().map(edge => edge.id)).toEqual([
      '/b.out.val->/code.par.code',
    ])
    expect(onProjectionChange).toHaveBeenCalledOnce()

    // Referenced values invalidate the target without rebuilding unchanged topology.
    onProjectionChange.mockClear()
    b.outputs.val.setValue(3)
    expect(onProjectionChange).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('removes live reference subscriptions and executor dependencies', () => {
    const nodes = [
      { id: '/a', type: 'NumberOp', data: { inputs: { val: 1 } }, position: { x: 0, y: 0 } },
      {
        id: '/code',
        type: 'CodeOp',
        data: { inputs: { code: "return op('/a').out.val" } },
        position: { x: 50, y: 0 },
      },
    ]

    transformGraph({ nodes, edges: [] })
    const code = getOpStore().getOp('/code') as CodeOp

    code.inputs.code.setValue('return 0')

    expect(code.inputs.code.subscriptions.has('/a.out.val->/code.par.code')).toBe(false)
    expect(getExecutor()!.getUpstream('/code')).toEqual(new Set())
    expect(referenceDependencyModel.getSnapshot()).toEqual([])
  })

  it('preserves non-reference executor edges when a live reference is removed', () => {
    const nodes = [
      { id: '/a', type: 'NumberOp', data: { inputs: { val: 1 } }, position: { x: 0, y: 0 } },
      {
        id: '/code',
        type: 'CodeOp',
        data: { inputs: { code: "return op('/a').out.val" } },
        position: { x: 50, y: 0 },
      },
    ]
    const edges = [
      {
        id: '/a.out.val->/code.par.data',
        source: '/a',
        sourceHandle: 'out.val',
        target: '/code',
        targetHandle: 'par.data',
      },
    ]

    transformGraph({ nodes, edges })
    const code = getOpStore().getOp('/code') as CodeOp
    expect(getExecutor()!.getUpstream('/code')).toEqual(new Set(['/a']))

    code.inputs.code.setValue('return 0')

    expect(getExecutor()!.getUpstream('/code')).toEqual(new Set(['/a']))
    expect(referenceDependencyModel.getSnapshot()).toEqual([])
  })

  it('does not make an enclosing-container param reference a pull dependency (false cycle)', () => {
    // op('/box').par.minMagnitude inside /box/child derives the reference
    // edge /box -> /box/child. With the child -> GraphOutput -> /box bridge
    // edge that would be a pull-dependency cycle _pullUpstreamDependencies
    // recurses on forever. The reference must stay a field-layer
    // subscription without entering the operator dependency sets.
    const nodes = [
      {
        id: '/box',
        type: 'ContainerOp',
        data: {
          inputs: {},
          customInputs: [
            { id: 'ci1', name: 'minMagnitude', type: 'number', order: 0, defaultValue: 4 },
          ],
        },
        position: { x: 0, y: 0 },
      },
      {
        id: '/box/child',
        type: 'CodeOp',
        data: { inputs: { code: "return op('/box').par.minMagnitude" } },
        position: { x: 10, y: 0 },
      },
      { id: '/box/output', type: 'GraphOutputOp', data: { inputs: {} }, position: { x: 20, y: 0 } },
    ]
    const edges = [
      {
        id: '/box/child.out.data->/box/output.par.value',
        source: '/box/child',
        target: '/box/output',
        sourceHandle: 'out.data',
        targetHandle: 'par.value',
      },
      {
        id: '/box/output.out.propagatedValue->/box.out.out',
        source: '/box/output',
        target: '/box',
        sourceHandle: 'out.propagatedValue',
        targetHandle: 'out.out',
      },
    ]

    transformGraph({ nodes, edges })

    const { getOp } = getOpStore()
    const box = getOp('/box')!
    const child = getOp('/box/child')!
    const deps = (child as unknown as { _upstreamDependencies: Set<unknown> })._upstreamDependencies
    expect(deps.has(box)).toBe(false)
    // The field-layer subscription for the derived reference edge remains.
    expect(child.inputs.code.subscriptions.has('/box.par.minMagnitude->/box/child.par.code')).toBe(
      true
    )
  })
})

describe('ListField connection order sync', () => {
  afterEach(() => {
    clearOps()
  })

  const numberNode = (id: string, val: number) => ({
    id,
    type: 'NumberOp',
    data: { inputs: { val } },
    position: { x: 0, y: 0 },
  })

  const concatNode = { id: '/concat', type: 'ConcatOp', data: {}, position: { x: 0, y: 0 } }

  const listEdge = (source: string) => ({
    id: edgeId({ source, target: '/concat', sourceHandle: 'out.val', targetHandle: 'par.values' }),
    source,
    target: '/concat',
    sourceHandle: 'out.val',
    targetHandle: 'par.values',
  })

  const connectionOrder = () => {
    const concat = getOpStore().getOp('/concat') as ConcatOp
    return Array.from(concat.inputs.values.fields.keys())
  }

  it('orders ListField connections by edge array order on first build', () => {
    const nodes = [numberNode('/a', 1), numberNode('/b', 2), numberNode('/c', 3), concatNode]
    const edges = [listEdge('/a'), listEdge('/b'), listEdge('/c')]

    transformGraph({ nodes, edges })

    expect(connectionOrder()).toEqual([listEdge('/a').id, listEdge('/b').id, listEdge('/c').id])
  })

  it('reorders existing connections when the edge array order changes', () => {
    const nodes = [numberNode('/a', 1), numberNode('/b', 2), numberNode('/c', 3), concatNode]

    transformGraph({ nodes, edges: [listEdge('/a'), listEdge('/b'), listEdge('/c')] })
    // Same edge ids, different array order — operators are reused from the store, and
    // addConnection alone would keep the stale Map order
    transformGraph({ nodes, edges: [listEdge('/c'), listEdge('/a'), listEdge('/b')] })

    expect(connectionOrder()).toEqual([listEdge('/c').id, listEdge('/a').id, listEdge('/b').id])
  })

  it('places a newly inserted mid-group edge at its array position', () => {
    const nodes = [numberNode('/a', 1), numberNode('/b', 2), numberNode('/c', 3), concatNode]

    transformGraph({ nodes, edges: [listEdge('/a'), listEdge('/c')] })
    // /b inserted between /a and /c; addConnection would append it last
    transformGraph({ nodes, edges: [listEdge('/a'), listEdge('/b'), listEdge('/c')] })

    expect(connectionOrder()).toEqual([listEdge('/a').id, listEdge('/b').id, listEdge('/c').id])
  })
})

describe('transform-graph container cascade deletion', () => {
  afterEach(() => {
    clearOps()
  })

  it('operator store is cleaned up when re-transforming without deleted container children', () => {
    const nodes = [
      { id: '/source', type: 'NumberOp', data: { inputs: {} }, position: { x: 0, y: 0 } },
      { id: '/container', type: 'ContainerOp', data: { inputs: {} }, position: { x: 0, y: 0 } },
      {
        id: '/container/container-input',
        type: 'GraphInputOp',
        data: { inputs: {} },
        position: { x: 0, y: 0 },
      },
      {
        id: '/container/container-output',
        type: 'GraphOutputOp',
        data: { inputs: {} },
        position: { x: 0, y: 0 },
      },
      { id: '/container/worker', type: 'MathOp', data: { inputs: {} }, position: { x: 0, y: 0 } },
      { id: '/sink', type: 'MathOp', data: { inputs: {} }, position: { x: 0, y: 0 } },
    ]
    const edges = [
      {
        id: '/source.out.val->/container.par.in',
        source: '/source',
        target: '/container',
        sourceHandle: 'out.val',
        targetHandle: 'par.in',
      },
      {
        id: '/container/container-input.out.parentValue->/container/worker.par.a',
        source: '/container/container-input',
        target: '/container/worker',
        sourceHandle: 'out.parentValue',
        targetHandle: 'par.a',
      },
    ]

    transformGraph({ nodes, edges })

    expect(hasOp('/container')).toBe(true)
    expect(hasOp('/container/worker')).toBe(true)
    expect(hasOp('/container/container-input')).toBe(true)
    expect(hasOp('/container/container-output')).toBe(true)

    // Re-transform without the container and its children (simulates cascade delete)
    const remainingNodes = nodes.filter(n => !n.id.startsWith('/container'))
    const remainingEdges = edges.filter(
      e => !e.source.startsWith('/container') && !e.target.startsWith('/container')
    )
    transformGraph({ nodes: remainingNodes, edges: remainingEdges })

    expect(hasOp('/container')).toBe(false)
    expect(hasOp('/container/worker')).toBe(false)
    expect(hasOp('/container/container-input')).toBe(false)
    expect(hasOp('/container/container-output')).toBe(false)
    expect(hasOp('/source')).toBe(true)
    expect(hasOp('/sink')).toBe(true)
  })
})
