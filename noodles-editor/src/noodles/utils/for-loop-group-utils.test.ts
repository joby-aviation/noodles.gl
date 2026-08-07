import type { Edge, Node } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { reconcileForLoopGroups } from './for-loop-group-utils'

function node(
  id: string,
  type: string,
  position: { x: number; y: number },
  parentId?: string,
  size = { width: 100, height: 60 }
): Node {
  return { id, type, position, parentId, measured: size, data: {} }
}

function group(id: string, position = { x: 0, y: 0 }, parentId?: string): Node {
  return {
    id,
    type: 'group',
    position,
    parentId,
    style: { width: 1200, height: 400 },
    data: {},
  }
}

function edge(source: string, target: string): Edge {
  return { id: `${source}->${target}`, source, target }
}

function byId(nodes: Node[], id: string): Node {
  return nodes.find(node => node.id === id)!
}

function absolutePosition(nodes: Node[], id: string): { x: number; y: number } {
  const current = byId(nodes, id)
  if (!current.parentId) return current.position
  const parent = absolutePosition(nodes, current.parentId)
  return { x: parent.x + current.position.x, y: parent.y + current.position.y }
}

describe('reconcileForLoopGroups', () => {
  it('adds a node on the Begin-to-End path while preserving its screen position', () => {
    const nodes = [
      node('/inserted', 'MathOp', { x: 500, y: 180 }),
      group('/body', { x: 100, y: 100 }),
      node('/begin', 'ForLoopBeginOp', { x: 0, y: 100 }, '/body'),
      node('/end', 'ForLoopEndOp', { x: 900, y: 100 }, '/body'),
      node('/meta', 'ForLoopMetaOp', { x: 450, y: 250 }, '/body'),
    ]

    const result = reconcileForLoopGroups(nodes, [
      edge('/begin', '/inserted'),
      edge('/inserted', '/end'),
    ])

    expect(byId(result, '/inserted').parentId).toBe('/body')
    expect(absolutePosition(result, '/inserted')).toEqual({ x: 500, y: 180 })
    expect(result.findIndex(node => node.id === '/body')).toBeLessThan(
      result.findIndex(node => node.id === '/inserted')
    )
  })

  it('removes disconnected former members from the visual group', () => {
    const nodes = [
      group('/body'),
      node('/begin', 'ForLoopBeginOp', { x: 40, y: 40 }, '/body'),
      node('/end', 'ForLoopEndOp', { x: 500, y: 40 }, '/body'),
      node('/old', 'MathOp', { x: 250, y: 40 }, '/body'),
    ]

    const result = reconcileForLoopGroups(nodes, [edge('/begin', '/end')])

    expect(byId(result, '/old').parentId).toBeUndefined()
    expect(absolutePosition(result, '/old')).toEqual({ x: 250, y: 40 })
  })

  it('includes rejoining branches but excludes dead-end branches', () => {
    const nodes = [
      group('/body'),
      node('/begin', 'ForLoopBeginOp', { x: 0, y: 0 }, '/body'),
      node('/end', 'ForLoopEndOp', { x: 900, y: 0 }, '/body'),
      node('/rejoins', 'MathOp', { x: 300, y: 0 }),
      node('/dead-end', 'MathOp', { x: 300, y: 200 }),
    ]
    const edges = [
      edge('/begin', '/rejoins'),
      edge('/rejoins', '/end'),
      edge('/begin', '/dead-end'),
    ]

    const result = reconcileForLoopGroups(nodes, edges)

    expect(byId(result, '/rejoins').parentId).toBe('/body')
    expect(byId(result, '/dead-end').parentId).toBeUndefined()
  })

  it('places an inner loop group inside its outer loop', () => {
    const nodes = [
      group('/outer-body'),
      node('/outer-begin', 'ForLoopBeginOp', { x: 0, y: 0 }, '/outer-body'),
      node('/outer-end', 'ForLoopEndOp', { x: 1000, y: 0 }, '/outer-body'),
      group('/inner-body', { x: 300, y: 100 }),
      node('/inner-begin', 'ForLoopBeginOp', { x: 0, y: 0 }, '/inner-body'),
      node('/inner-end', 'ForLoopEndOp', { x: 300, y: 0 }, '/inner-body'),
    ]
    const edges = [
      edge('/outer-begin', '/inner-begin'),
      edge('/inner-begin', '/inner-end'),
      edge('/inner-end', '/outer-end'),
    ]

    const result = reconcileForLoopGroups(nodes, edges)

    expect(byId(result, '/inner-body').parentId).toBe('/outer-body')
    expect(byId(result, '/inner-begin').parentId).toBe('/inner-body')
    expect(byId(result, '/inner-end').parentId).toBe('/inner-body')
  })

  it('keeps the current owner for a node shared by two loop scopes', () => {
    const nodes = [
      group('/a-body'),
      node('/a-begin', 'ForLoopBeginOp', { x: 0, y: 0 }, '/a-body'),
      node('/a-end', 'ForLoopEndOp', { x: 500, y: 0 }, '/a-body'),
      group('/b-body', { x: 0, y: 300 }),
      node('/b-begin', 'ForLoopBeginOp', { x: 0, y: 0 }, '/b-body'),
      node('/b-end', 'ForLoopEndOp', { x: 500, y: 0 }, '/b-body'),
      node('/shared', 'MathOp', { x: 250, y: 0 }, '/b-body'),
    ]
    const edges = [
      edge('/a-begin', '/shared'),
      edge('/shared', '/a-end'),
      edge('/b-begin', '/shared'),
      edge('/shared', '/b-end'),
    ]

    const result = reconcileForLoopGroups(nodes, edges)

    expect(byId(result, '/shared').parentId).toBe('/b-body')
  })
})
