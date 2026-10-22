import { describe, expect, it } from 'vitest'
import type { NoodlesProjectJSON } from '../utils/serialization'
import { down, up } from './010-parent-node-to-parent-id'

describe('migration 010 up', () => {
  it('converts parentNode to parentId for ForLoop nodes', async () => {
    // ForLoop creates a group node with ForLoopBeginOp and ForLoopEndOp as children
    const project = {
      version: 9,
      nodes: [
        {
          id: '/for-loop-body-1',
          type: 'group',
          position: { x: 0, y: 0 },
          style: { width: 1200, height: 300 },
        },
        {
          id: '/for-loop-begin-1',
          type: 'ForLoopBeginOp',
          position: { x: 0, y: 100 },
          data: { inputs: {} },
          parentNode: '/for-loop-body-1', // Old v11 format
          expandParent: true,
        },
        {
          id: '/for-loop-end-1',
          type: 'ForLoopEndOp',
          position: { x: 900, y: 100 },
          data: { inputs: {} },
          parentNode: '/for-loop-body-1', // Old v11 format
          expandParent: true,
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    } as NoodlesProjectJSON

    const migrated = await up(project)

    // Should have parentId instead of parentNode
    expect(migrated.nodes[1].parentId).toBe('/for-loop-body-1')
    expect(migrated.nodes[2].parentId).toBe('/for-loop-body-1')
    expect((migrated.nodes[1] as any).parentNode).toBeUndefined()
    expect((migrated.nodes[2] as any).parentNode).toBeUndefined()
  })

  it('preserves existing parentId over parentNode', async () => {
    const project = {
      version: 9,
      nodes: [
        {
          id: '/for-loop-body-1',
          type: 'group',
          position: { x: 0, y: 0 },
          style: { width: 1200, height: 300 },
        },
        {
          id: '/for-loop-begin-1',
          type: 'ForLoopBeginOp',
          position: { x: 0, y: 100 },
          data: { inputs: {} },
          parentId: '/for-loop-body-1',
          parentNode: '/wrong-parent', // Should be ignored since parentId exists
          expandParent: true,
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    } as NoodlesProjectJSON

    const migrated = await up(project)

    // Should keep existing parentId
    expect(migrated.nodes[1].parentId).toBe('/for-loop-body-1')
    expect((migrated.nodes[1] as any).parentNode).toBeUndefined()
  })

  it('leaves nodes without parentNode unchanged', async () => {
    const project = {
      version: 9,
      nodes: [
        {
          id: '/standalone',
          type: 'CodeOp',
          position: { x: 0, y: 0 },
          data: { inputs: {} },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    } as NoodlesProjectJSON

    const migrated = await up(project)

    expect(migrated.nodes[0].parentId).toBeUndefined()
    expect((migrated.nodes[0] as any).parentNode).toBeUndefined()
  })

  it('handles multiple nested children', async () => {
    const project = {
      version: 9,
      nodes: [
        {
          id: '/container',
          type: 'ContainerOp',
          position: { x: 0, y: 0 },
          data: { inputs: {} },
        },
        {
          id: '/container/child1',
          type: 'CodeOp',
          position: { x: 10, y: 10 },
          data: { inputs: {} },
          parentNode: '/container',
        },
        {
          id: '/container/child2',
          type: 'NumberOp',
          position: { x: 20, y: 20 },
          data: { inputs: {} },
          parentNode: '/container',
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    } as NoodlesProjectJSON

    const migrated = await up(project)

    expect(migrated.nodes[0].parentId).toBeUndefined()
    expect(migrated.nodes[1].parentId).toBe('/container')
    expect(migrated.nodes[2].parentId).toBe('/container')
    expect((migrated.nodes[1] as any).parentNode).toBeUndefined()
    expect((migrated.nodes[2] as any).parentNode).toBeUndefined()
  })
})

describe('migration 010 down', () => {
  it('converts parentId back to parentNode', async () => {
    const project = {
      version: 10,
      nodes: [
        {
          id: '/for-loop-body-1',
          type: 'group',
          position: { x: 0, y: 0 },
          style: { width: 1200, height: 300 },
        },
        {
          id: '/for-loop-begin-1',
          type: 'ForLoopBeginOp',
          position: { x: 0, y: 100 },
          data: { inputs: {} },
          parentId: '/for-loop-body-1',
          expandParent: true,
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    } as NoodlesProjectJSON

    const reverted = await down(project)

    // Should have parentNode instead of parentId
    expect((reverted.nodes[1] as any).parentNode).toBe('/for-loop-body-1')
    expect(reverted.nodes[1].parentId).toBeUndefined()
  })

  it('leaves nodes without parentId unchanged', async () => {
    const project = {
      version: 10,
      nodes: [
        {
          id: '/standalone',
          type: 'CodeOp',
          position: { x: 0, y: 0 },
          data: { inputs: {} },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    } as NoodlesProjectJSON

    const reverted = await down(project)

    expect(reverted.nodes[0].parentId).toBeUndefined()
    expect((reverted.nodes[0] as any).parentNode).toBeUndefined()
  })

  it('is reversible with up migration', async () => {
    const originalProject = {
      version: 9,
      nodes: [
        {
          id: '/for-loop-body-1',
          type: 'group',
          position: { x: 0, y: 0 },
          style: { width: 1200, height: 300 },
        },
        {
          id: '/for-loop-begin-1',
          type: 'ForLoopBeginOp',
          position: { x: 0, y: 100 },
          data: { inputs: {} },
          parentNode: '/for-loop-body-1',
          expandParent: true,
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    } as NoodlesProjectJSON

    // Migrate up then down
    const migrated = await up(originalProject)
    const reverted = await down(migrated)

    // Should be back to parentNode format
    expect((reverted.nodes[1] as any).parentNode).toBe('/for-loop-body-1')
    expect(reverted.nodes[1].parentId).toBeUndefined()
  })
})
