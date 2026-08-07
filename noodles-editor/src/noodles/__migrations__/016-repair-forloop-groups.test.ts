import type { Edge, Node } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import type { NoodlesProjectJSON } from '../utils/serialization'
import { down, up } from './016-repair-forloop-groups'

function node(
  id: string,
  type: string,
  position: { x: number; y: number },
  parentId?: string
): Node {
  return { id, type, position, parentId, width: 100, height: 60, data: {} }
}

function edge(source: string, target: string): Edge {
  return { id: `${source}->${target}`, source, target }
}

function absolutePosition(nodes: Node[], id: string): { x: number; y: number } {
  const current = nodes.find(node => node.id === id)!
  if (!current.parentId) return current.position
  const parent = absolutePosition(nodes, current.parentId)
  return { x: parent.x + current.position.x, y: parent.y + current.position.y }
}

function makeProject(nodes: Node[], edges: Edge[]): NoodlesProjectJSON {
  return {
    version: 15,
    nodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 1 },
    timeline: {},
  }
}

describe('016-repair-forloop-groups', () => {
  it('reconstructs unique groups for legacy unparented loop triplets', async () => {
    const nodes: Node[] = [
      {
        id: '/for-loop-body',
        type: 'group',
        position: { x: -5000, y: -4000 },
        style: { width: 12000, height: 7000 },
        data: {},
      },
      node('/for-loop-begin', 'ForLoopBeginOp', { x: -4300, y: 900 }),
      node('/first-body', 'MathOp', { x: -3900, y: 900 }),
      node('/for-loop-end', 'ForLoopEndOp', { x: -3400, y: 900 }),
      node('/for-loop-meta', 'ForLoopMetaOp', { x: -3800, y: 1200 }),
      node('/for-loop-begin-1', 'ForLoopBeginOp', { x: 2000, y: -3600 }),
      node('/second-body', 'MathOp', { x: 3500, y: -3600 }),
      node('/for-loop-end-1', 'ForLoopEndOp', { x: 4800, y: -3600 }),
      node('/for-loop-meta-1', 'ForLoopMetaOp', { x: 3500, y: -3100 }),
      node('/for-loop-begin-2', 'ForLoopBeginOp', { x: -700, y: -4700 }),
      node('/third-body', 'MathOp', { x: -300, y: -4700 }),
      node('/for-loop-end-2', 'ForLoopEndOp', { x: 100, y: -4700 }),
      node('/for-loop-meta-2', 'ForLoopMetaOp', { x: -300, y: -4400 }),
      node('/unrelated', 'MathOp', { x: 7000, y: 7000 }),
    ]
    const edges = [
      edge('/for-loop-begin', '/first-body'),
      edge('/first-body', '/for-loop-end'),
      edge('/for-loop-begin-1', '/second-body'),
      edge('/second-body', '/for-loop-end-1'),
      edge('/for-loop-begin-2', '/third-body'),
      edge('/third-body', '/for-loop-end-2'),
    ]
    const originalPositions = new Map(
      nodes
        .filter(current => current.type !== 'group')
        .map(current => [current.id, absolutePosition(nodes, current.id)])
    )

    const migrated = await up(makeProject(nodes, edges))
    const migratedNodes = migrated.nodes as Node[]

    expect(
      migratedNodes.filter(current => current.type === 'group').map(current => current.id)
    ).toEqual(['/for-loop-body', '/for-loop-body-1', '/for-loop-body-2'])
    for (const suffix of ['', '-1', '-2']) {
      const groupId = `/for-loop-body${suffix}`
      expect(
        migratedNodes.find(current => current.id === `/for-loop-begin${suffix}`)?.parentId
      ).toBe(groupId)
      expect(migratedNodes.find(current => current.id === `/for-loop-end${suffix}`)?.parentId).toBe(
        groupId
      )
      expect(
        migratedNodes.find(current => current.id === `/for-loop-meta${suffix}`)?.parentId
      ).toBe(groupId)
    }
    expect(migratedNodes.find(current => current.id === '/first-body')?.parentId).toBe(
      '/for-loop-body'
    )
    expect(migratedNodes.find(current => current.id === '/second-body')?.parentId).toBe(
      '/for-loop-body-1'
    )
    expect(migratedNodes.find(current => current.id === '/third-body')?.parentId).toBe(
      '/for-loop-body-2'
    )
    expect(migratedNodes.find(current => current.id === '/unrelated')?.parentId).toBeUndefined()
    for (const [id, position] of originalPositions) {
      expect(absolutePosition(migratedNodes, id)).toEqual(position)
    }
  })

  it('does not guess when generated boundaries are incomplete or disconnected', async () => {
    const nodes = [
      node('/for-loop-begin', 'ForLoopBeginOp', { x: 0, y: 0 }),
      node('/for-loop-end', 'ForLoopEndOp', { x: 500, y: 0 }),
      node('/for-loop-begin-1', 'ForLoopBeginOp', { x: 0, y: 300 }),
    ]
    const project = makeProject(nodes, [])

    const migrated = await up(project)

    expect(migrated).toBe(project)
  })

  it('keeps repaired v16 group data when migrating down', async () => {
    const project = makeProject([], [])

    expect(await down(project)).toBe(project)
  })
})
