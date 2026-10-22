import { describe, expect, it } from 'vitest'
import type { NoodlesProjectJSON } from '../utils/serialization'
import { down, up } from './011-forloop-d-to-item'

describe('migration 011 up', () => {
  it('renames ForLoopBeginOp output from d to item', async () => {
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
        },
        {
          id: '/for-loop-end-1',
          type: 'ForLoopEndOp',
          position: { x: 900, y: 100 },
          data: { inputs: {} },
          parentId: '/for-loop-body-1',
        },
      ],
      edges: [
        {
          id: '/for-loop-begin-1.out.d->/for-loop-end-1.par.d',
          source: '/for-loop-begin-1',
          target: '/for-loop-end-1',
          sourceHandle: 'out.d',
          targetHandle: 'par.d',
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    } as NoodlesProjectJSON

    const migrated = await up(project)

    // Edge should be updated with new handle names
    expect(migrated.edges[0].sourceHandle).toBe('out.item')
    expect(migrated.edges[0].targetHandle).toBe('par.item')
    expect(migrated.edges[0].id).toBe('/for-loop-begin-1.out.item->/for-loop-end-1.par.item')
  })

  it('handles projects without ForLoop nodes', async () => {
    const project = {
      version: 10,
      nodes: [
        {
          id: '/code-1',
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

    // Should return unchanged project
    expect(migrated).toEqual(project)
  })

  it('handles ForLoop nodes without d edges', async () => {
    const project = {
      version: 10,
      nodes: [
        {
          id: '/for-loop-begin-1',
          type: 'ForLoopBeginOp',
          position: { x: 0, y: 100 },
          data: { inputs: {} },
        },
        {
          id: '/for-loop-end-1',
          type: 'ForLoopEndOp',
          position: { x: 900, y: 100 },
          data: { inputs: {} },
        },
      ],
      edges: [], // No edges connecting them
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    } as NoodlesProjectJSON

    const migrated = await up(project)

    // Should return unchanged project since no edges to migrate
    expect(migrated.edges).toEqual([])
  })

  it('migrates ForLoop with intermediate operators', async () => {
    const project = {
      version: 10,
      nodes: [
        {
          id: '/for-loop-begin-1',
          type: 'ForLoopBeginOp',
          position: { x: 0, y: 100 },
          data: { inputs: {} },
        },
        {
          id: '/math-1',
          type: 'MathOp',
          position: { x: 300, y: 100 },
          data: { inputs: { operator: 'add' } },
        },
        {
          id: '/for-loop-end-1',
          type: 'ForLoopEndOp',
          position: { x: 900, y: 100 },
          data: { inputs: {} },
        },
      ],
      edges: [
        {
          id: '/for-loop-begin-1.out.d->/math-1.par.a',
          source: '/for-loop-begin-1',
          target: '/math-1',
          sourceHandle: 'out.d',
          targetHandle: 'par.a',
        },
        {
          id: '/math-1.out.result->/for-loop-end-1.par.d',
          source: '/math-1',
          target: '/for-loop-end-1',
          sourceHandle: 'out.result',
          targetHandle: 'par.d',
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    } as NoodlesProjectJSON

    const migrated = await up(project)

    // First edge: ForLoopBeginOp.out.d -> MathOp.par.a should have updated sourceHandle
    expect(migrated.edges[0].sourceHandle).toBe('out.item')
    expect(migrated.edges[0].targetHandle).toBe('par.a') // Unchanged
    expect(migrated.edges[0].id).toBe('/for-loop-begin-1.out.item->/math-1.par.a')

    // Second edge: MathOp.out.result -> ForLoopEndOp.par.d should have updated targetHandle
    expect(migrated.edges[1].sourceHandle).toBe('out.result') // Unchanged
    expect(migrated.edges[1].targetHandle).toBe('par.item')
    expect(migrated.edges[1].id).toBe('/math-1.out.result->/for-loop-end-1.par.item')
  })
})

describe('migration 011 down', () => {
  it('renames ForLoopBeginOp output from item back to d', async () => {
    const project = {
      version: 11,
      nodes: [
        {
          id: '/for-loop-begin-1',
          type: 'ForLoopBeginOp',
          position: { x: 0, y: 100 },
          data: { inputs: {} },
        },
        {
          id: '/for-loop-end-1',
          type: 'ForLoopEndOp',
          position: { x: 900, y: 100 },
          data: { inputs: {} },
        },
      ],
      edges: [
        {
          id: '/for-loop-begin-1.out.item->/for-loop-end-1.par.item',
          source: '/for-loop-begin-1',
          target: '/for-loop-end-1',
          sourceHandle: 'out.item',
          targetHandle: 'par.item',
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    } as NoodlesProjectJSON

    const reverted = await down(project)

    expect(reverted.edges[0].sourceHandle).toBe('out.d')
    expect(reverted.edges[0].targetHandle).toBe('par.d')
    expect(reverted.edges[0].id).toBe('/for-loop-begin-1.out.d->/for-loop-end-1.par.d')
  })

  it('is reversible with up migration', async () => {
    const originalProject = {
      version: 10,
      nodes: [
        {
          id: '/for-loop-begin-1',
          type: 'ForLoopBeginOp',
          position: { x: 0, y: 100 },
          data: { inputs: {} },
        },
        {
          id: '/for-loop-end-1',
          type: 'ForLoopEndOp',
          position: { x: 900, y: 100 },
          data: { inputs: {} },
        },
      ],
      edges: [
        {
          id: '/for-loop-begin-1.out.d->/for-loop-end-1.par.d',
          source: '/for-loop-begin-1',
          target: '/for-loop-end-1',
          sourceHandle: 'out.d',
          targetHandle: 'par.d',
        },
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    } as NoodlesProjectJSON

    // Migrate up then down
    const migrated = await up(originalProject)
    const reverted = await down(migrated)

    // Should be back to original format
    expect(reverted.edges[0].sourceHandle).toBe('out.d')
    expect(reverted.edges[0].targetHandle).toBe('par.d')
  })
})
