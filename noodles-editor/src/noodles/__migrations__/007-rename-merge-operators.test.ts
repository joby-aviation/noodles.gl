import { describe, expect, it } from 'vitest'
import type { NoodlesProjectJSON } from '../utils/serialization'
import { down, up } from './007-rename-merge-operators'

const createProjectWithMergeOp = (): NoodlesProjectJSON => ({
  version: 6,
  nodes: [
    {
      id: '/merge-1',
      type: 'MergeOp',
      position: { x: 100, y: 100 },
      data: {
        inputs: {
          values: [
            [1, 2],
            [3, 4],
          ],
          depth: 1,
        },
      },
    },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  timeline: {},
})

const createProjectWithObjectMergeOp = (): NoodlesProjectJSON => ({
  version: 6,
  nodes: [
    {
      id: '/object-merge-1',
      type: 'ObjectMergeOp',
      position: { x: 200, y: 200 },
      data: {
        inputs: {
          objects: [{ a: 1 }, { b: 2 }],
        },
      },
    },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  timeline: {},
})

const createProjectWithBothOps = (): NoodlesProjectJSON => ({
  version: 6,
  nodes: [
    {
      id: '/merge-1',
      type: 'MergeOp',
      position: { x: 100, y: 100 },
      data: {
        inputs: {
          values: [
            [1, 2],
            [3, 4],
          ],
          depth: 1,
        },
      },
    },
    {
      id: '/object-merge-1',
      type: 'ObjectMergeOp',
      position: { x: 200, y: 200 },
      data: {
        inputs: {
          objects: [{ a: 1 }, { b: 2 }],
        },
      },
    },
    {
      id: '/other-op',
      type: 'NumberOp',
      position: { x: 300, y: 300 },
      data: {
        inputs: {
          value: 42,
        },
      },
    },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  timeline: {},
})

const createProjectWithConcatOp = (): NoodlesProjectJSON => ({
  version: 7,
  nodes: [
    {
      id: '/concat-1',
      type: 'ConcatOp',
      position: { x: 100, y: 100 },
      data: {
        inputs: {
          values: [
            [1, 2],
            [3, 4],
          ],
          depth: 1,
        },
      },
    },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  timeline: {},
})

const createProjectWithNewMergeOp = (): NoodlesProjectJSON => ({
  version: 7,
  nodes: [
    {
      id: '/merge-1',
      type: 'MergeOp',
      position: { x: 200, y: 200 },
      data: {
        inputs: {
          objects: [{ a: 1 }, { b: 2 }],
        },
      },
    },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  timeline: {},
})

describe('migration 007 up', () => {
  it('renames MergeOp to ConcatOp', async () => {
    const project = createProjectWithMergeOp()
    const migrated = await up(project)

    expect(migrated.nodes).toHaveLength(1)
    expect(migrated.nodes[0].type).toBe('ConcatOp')
    expect(migrated.nodes[0].id).toBe('/merge-1')
  })

  it('renames ObjectMergeOp to MergeOp', async () => {
    const project = createProjectWithObjectMergeOp()
    const migrated = await up(project)

    expect(migrated.nodes).toHaveLength(1)
    expect(migrated.nodes[0].type).toBe('MergeOp')
    expect(migrated.nodes[0].id).toBe('/object-merge-1')
  })

  it('renames both operators correctly', async () => {
    const project = createProjectWithBothOps()
    const migrated = await up(project)

    expect(migrated.nodes).toHaveLength(3)

    const concatNode = migrated.nodes.find(n => n.id === '/merge-1')
    expect(concatNode?.type).toBe('ConcatOp')

    const mergeNode = migrated.nodes.find(n => n.id === '/object-merge-1')
    expect(mergeNode?.type).toBe('MergeOp')

    const otherNode = migrated.nodes.find(n => n.id === '/other-op')
    expect(otherNode?.type).toBe('NumberOp')
  })

  it('preserves node data during rename', async () => {
    const project = createProjectWithMergeOp()
    const migrated = await up(project)

    expect(migrated.nodes[0].data.inputs.values).toEqual([
      [1, 2],
      [3, 4],
    ])
    expect(migrated.nodes[0].data.inputs.depth).toBe(1)
  })

  it('preserves node position and other properties', async () => {
    const project = createProjectWithMergeOp()
    const migrated = await up(project)

    expect(migrated.nodes[0].position).toEqual({ x: 100, y: 100 })
    expect(migrated.nodes[0].id).toBe('/merge-1')
  })

  it('preserves edges', async () => {
    const project: NoodlesProjectJSON = {
      ...createProjectWithMergeOp(),
      edges: [
        {
          id: 'edge-1',
          source: '/merge-1',
          target: '/other',
          sourceHandle: 'out.data',
          targetHandle: 'par.input',
        },
      ],
    }
    const migrated = await up(project)

    expect(migrated.edges).toHaveLength(1)
    expect(migrated.edges[0]).toEqual({
      id: 'edge-1',
      source: '/merge-1',
      target: '/other',
      sourceHandle: 'out.data',
      targetHandle: 'par.input',
    })
  })

  it('preserves timeline data including sequences', async () => {
    const project: NoodlesProjectJSON = {
      ...createProjectWithMergeOp(),
      timeline: {
        definitionVersion: '0.4.0',
        sheetsById: {
          Noodles: {
            sequence: {
              tracksByObject: {
                '/merge-1': {
                  trackData: {
                    depth: {
                      type: 'BasicKeyframedTrack',
                      keyframes: [
                        { position: 0, value: 1 },
                        { position: 5, value: 2 },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      },
    }
    const migrated = await up(project)

    expect(migrated.timeline.definitionVersion).toBe('0.4.0')
    // Timeline should be preserved exactly as-is since it references operators by ID, not type
    expect(migrated.timeline.sheetsById.Noodles.sequence.tracksByObject['/merge-1']).toBeDefined()
    expect(migrated.timeline.sheetsById.Noodles.sequence.tracksByObject['/merge-1']).toEqual(
      project.timeline.sheetsById.Noodles.sequence.tracksByObject['/merge-1']
    )
  })

  it('handles projects without nodes', async () => {
    const project: NoodlesProjectJSON = {
      version: 6,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }

    const migrated = await up(project)
    expect(migrated.nodes).toEqual([])
  })

  it('handles projects without timeline', async () => {
    const project = createProjectWithMergeOp()
    const migrated = await up(project)

    expect(migrated.timeline).toBeDefined()
  })
})

describe('migration 007 down', () => {
  it('reverts ConcatOp to MergeOp', async () => {
    const project = createProjectWithConcatOp()
    const reverted = await down(project)

    expect(reverted.nodes).toHaveLength(1)
    expect(reverted.nodes[0].type).toBe('MergeOp')
    expect(reverted.nodes[0].id).toBe('/concat-1')
  })

  it('reverts MergeOp to ObjectMergeOp', async () => {
    const project = createProjectWithNewMergeOp()
    const reverted = await down(project)

    expect(reverted.nodes).toHaveLength(1)
    expect(reverted.nodes[0].type).toBe('ObjectMergeOp')
    expect(reverted.nodes[0].id).toBe('/merge-1')
  })

  it('preserves node data during revert', async () => {
    const project = createProjectWithConcatOp()
    const reverted = await down(project)

    expect(reverted.nodes[0].data.inputs.values).toEqual([
      [1, 2],
      [3, 4],
    ])
    expect(reverted.nodes[0].data.inputs.depth).toBe(1)
  })

  it('is reversible with up migration', async () => {
    const originalProject = createProjectWithBothOps()

    // Migrate up then down
    const migrated = await up(originalProject)
    const reverted = await down(migrated)

    // Should have original operator types back
    const mergeNode = reverted.nodes.find(n => n.id === '/merge-1')
    expect(mergeNode?.type).toBe('MergeOp')

    const objectMergeNode = reverted.nodes.find(n => n.id === '/object-merge-1')
    expect(objectMergeNode?.type).toBe('ObjectMergeOp')

    const otherNode = reverted.nodes.find(n => n.id === '/other-op')
    expect(otherNode?.type).toBe('NumberOp')
  })

  it('handles projects without nodes', async () => {
    const project: NoodlesProjectJSON = {
      version: 7,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }

    const reverted = await down(project)
    expect(reverted.nodes).toEqual([])
  })
})
