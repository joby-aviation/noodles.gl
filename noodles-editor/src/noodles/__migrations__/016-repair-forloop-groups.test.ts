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
  it('reconstructs unique groups from operator types and connectivity after markers are renamed', async () => {
    const nodes: Node[] = [
      {
        id: '/legacy-loop-shell',
        type: 'group',
        position: { x: -5000, y: -4000 },
        style: { width: 12000, height: 7000 },
        selectable: false,
        draggable: false,
        data: {},
      },
      node('/start-alpha', 'ForLoopBeginOp', { x: -4300, y: 900 }),
      node('/first-body', 'MathOp', { x: -3900, y: 900 }),
      node('/finish-alpha', 'ForLoopEndOp', { x: -3400, y: 900 }),
      node('/meta-near-alpha', 'ForLoopMetaOp', { x: -3800, y: 1200 }),
      node('/renamed-start', 'ForLoopBeginOp', { x: 2000, y: -3600 }),
      node('/second-body', 'MathOp', { x: 3500, y: -3600 }),
      node('/renamed-finish', 'ForLoopEndOp', { x: 4800, y: -3600 }),
      node('/unrelated-meta-name', 'ForLoopMetaOp', { x: 3500, y: -3100 }),
      node('/loop-entry-custom', 'ForLoopBeginOp', { x: -700, y: -4700 }),
      node('/third-body', 'MathOp', { x: -300, y: -4700 }),
      node('/loop-exit-custom', 'ForLoopEndOp', { x: 100, y: -4700 }),
      node('/metadata-custom', 'ForLoopMetaOp', { x: -300, y: -4400 }),
      node('/unrelated', 'MathOp', { x: 7000, y: 7000 }),
    ]
    const edges = [
      edge('/start-alpha', '/first-body'),
      edge('/first-body', '/finish-alpha'),
      edge('/renamed-start', '/second-body'),
      edge('/second-body', '/renamed-finish'),
      edge('/loop-entry-custom', '/third-body'),
      edge('/third-body', '/loop-exit-custom'),
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
    ).toEqual(['/legacy-loop-shell', '/for-loop-body', '/for-loop-body-1'])
    for (const [beginId, endId, metaId, groupId] of [
      ['/start-alpha', '/finish-alpha', '/meta-near-alpha', '/legacy-loop-shell'],
      ['/renamed-start', '/renamed-finish', '/unrelated-meta-name', '/for-loop-body'],
      ['/loop-entry-custom', '/loop-exit-custom', '/metadata-custom', '/for-loop-body-1'],
    ]) {
      expect(migratedNodes.find(current => current.id === beginId)?.parentId).toBe(groupId)
      expect(migratedNodes.find(current => current.id === endId)?.parentId).toBe(groupId)
      expect(migratedNodes.find(current => current.id === metaId)?.parentId).toBe(groupId)
    }
    expect(migratedNodes.find(current => current.id === '/first-body')?.parentId).toBe(
      '/legacy-loop-shell'
    )
    expect(migratedNodes.find(current => current.id === '/second-body')?.parentId).toBe(
      '/for-loop-body'
    )
    expect(migratedNodes.find(current => current.id === '/third-body')?.parentId).toBe(
      '/for-loop-body-1'
    )
    expect(migratedNodes.find(current => current.id === '/unrelated')?.parentId).toBeUndefined()
    for (const [id, position] of originalPositions) {
      expect(absolutePosition(migratedNodes, id)).toEqual(position)
    }
  })

  it('does not guess when boundaries are incomplete or disconnected', async () => {
    const nodes = [
      node('/start', 'ForLoopBeginOp', { x: 0, y: 0 }),
      node('/finish', 'ForLoopEndOp', { x: 500, y: 0 }),
      node('/another-start', 'ForLoopBeginOp', { x: 0, y: 300 }),
    ]
    const project = makeProject(nodes, [])

    const migrated = await up(project)

    expect(migrated).toBe(project)
  })

  it('pairs nested boundaries from the inside out', async () => {
    const nodes = [
      node('/outer-start', 'ForLoopBeginOp', { x: 0, y: 0 }),
      node('/inner-start', 'ForLoopBeginOp', { x: 300, y: 100 }),
      node('/inner-finish', 'ForLoopEndOp', { x: 600, y: 100 }),
      node('/outer-finish', 'ForLoopEndOp', { x: 900, y: 0 }),
    ]
    const edges = [
      edge('/outer-start', '/inner-start'),
      edge('/inner-start', '/inner-finish'),
      edge('/inner-finish', '/outer-finish'),
    ]

    const migrated = await up(makeProject(nodes, edges))
    const migratedNodes = migrated.nodes as Node[]
    const innerGroupId = migratedNodes.find(node => node.id === '/inner-start')?.parentId
    const outerGroupId = migratedNodes.find(node => node.id === '/outer-start')?.parentId

    expect(innerGroupId).toBe('/for-loop-body')
    expect(outerGroupId).toBe('/for-loop-body-1')
    expect(migratedNodes.find(node => node.id === '/inner-finish')?.parentId).toBe(innerGroupId)
    expect(migratedNodes.find(node => node.id === '/outer-finish')?.parentId).toBe(outerGroupId)
    expect(migratedNodes.find(node => node.id === innerGroupId)?.parentId).toBe(outerGroupId)
  })

  it('keeps repaired v16 group data when migrating down', async () => {
    const project = makeProject([], [])

    expect(await down(project)).toBe(project)
  })
})
