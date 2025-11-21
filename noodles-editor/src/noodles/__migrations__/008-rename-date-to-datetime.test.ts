import { describe, expect, it } from 'vitest'
import type { NoodlesProjectJSON } from '../utils/serialization'
import { down, up } from './008-rename-date-to-datetime'

const createProjectWithDateOp = (): NoodlesProjectJSON => ({
  version: 7,
  nodes: [
    {
      id: '/date-1',
      type: 'DateOp',
      position: { x: 100, y: 100 },
      data: {
        inputs: {
          date: '2024-01-01T00:00:00',
        },
      },
    },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  timeline: {},
})

const createProjectWithDateTimeOp = (): NoodlesProjectJSON => ({
  version: 8,
  nodes: [
    {
      id: '/date-1',
      type: 'DateTimeOp',
      position: { x: 100, y: 100 },
      data: {
        inputs: {
          date: '2024-01-01T00:00:00',
        },
      },
    },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  timeline: {},
})

const createProjectWithMultipleOps = (): NoodlesProjectJSON => ({
  version: 7,
  nodes: [
    {
      id: '/date-1',
      type: 'DateOp',
      position: { x: 100, y: 100 },
      data: {
        inputs: {
          date: '2024-01-01T00:00:00',
        },
      },
    },
    {
      id: '/number-1',
      type: 'NumberOp',
      position: { x: 200, y: 200 },
      data: {
        inputs: {
          value: 42,
        },
      },
    },
    {
      id: '/date-2',
      type: 'DateOp',
      position: { x: 300, y: 300 },
      data: {
        inputs: {
          date: '2024-12-31T23:59:59',
        },
      },
    },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  timeline: {},
})

describe('migration 008 up', () => {
  it('renames DateOp to DateTimeOp', async () => {
    const project = createProjectWithDateOp()
    const migrated = await up(project)

    expect(migrated.nodes).toHaveLength(1)
    expect(migrated.nodes[0].type).toBe('DateTimeOp')
    expect(migrated.nodes[0].id).toBe('/date-1')
  })

  it('renames multiple DateOp instances', async () => {
    const project = createProjectWithMultipleOps()
    const migrated = await up(project)

    expect(migrated.nodes).toHaveLength(3)

    const dateNode1 = migrated.nodes.find(n => n.id === '/date-1')
    expect(dateNode1?.type).toBe('DateTimeOp')

    const dateNode2 = migrated.nodes.find(n => n.id === '/date-2')
    expect(dateNode2?.type).toBe('DateTimeOp')

    const numberNode = migrated.nodes.find(n => n.id === '/number-1')
    expect(numberNode?.type).toBe('NumberOp')
  })

  it('preserves node data during rename', async () => {
    const project = createProjectWithDateOp()
    const migrated = await up(project)

    expect(migrated.nodes[0].data.inputs.date).toBe('2024-01-01T00:00:00')
  })

  it('preserves node position and other properties', async () => {
    const project = createProjectWithDateOp()
    const migrated = await up(project)

    expect(migrated.nodes[0].position).toEqual({ x: 100, y: 100 })
    expect(migrated.nodes[0].id).toBe('/date-1')
  })

  it('preserves edges', async () => {
    const project: NoodlesProjectJSON = {
      ...createProjectWithDateOp(),
      edges: [
        {
          id: 'edge-1',
          source: '/date-1',
          target: '/other',
          sourceHandle: 'out.date',
          targetHandle: 'par.input',
        },
      ],
    }
    const migrated = await up(project)

    expect(migrated.edges).toHaveLength(1)
    expect(migrated.edges[0]).toEqual({
      id: 'edge-1',
      source: '/date-1',
      target: '/other',
      sourceHandle: 'out.date',
      targetHandle: 'par.input',
    })
  })

  it('preserves timeline data including sequences', async () => {
    const project: NoodlesProjectJSON = {
      ...createProjectWithDateOp(),
      timeline: {
        definitionVersion: '0.4.0',
        sheetsById: {
          Noodles: {
            sequence: {
              tracksByObject: {
                '/date-1': {
                  trackData: {
                    date: {
                      type: 'BasicKeyframedTrack',
                      keyframes: [
                        { position: 0, value: '2024-01-01T00:00:00' },
                        { position: 5, value: '2024-12-31T23:59:59' },
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
    expect(migrated.timeline.sheetsById.Noodles.sequence.tracksByObject['/date-1']).toBeDefined()
    expect(migrated.timeline.sheetsById.Noodles.sequence.tracksByObject['/date-1']).toEqual(
      project.timeline.sheetsById.Noodles.sequence.tracksByObject['/date-1']
    )
  })

  it('handles projects without nodes', async () => {
    const project: NoodlesProjectJSON = {
      version: 7,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }

    const migrated = await up(project)
    expect(migrated.nodes).toEqual([])
  })

  it('handles projects without timeline', async () => {
    const project = createProjectWithDateOp()
    const migrated = await up(project)

    expect(migrated.timeline).toBeDefined()
  })
})

describe('migration 008 down', () => {
  it('reverts DateTimeOp to DateOp', async () => {
    const project = createProjectWithDateTimeOp()
    const reverted = await down(project)

    expect(reverted.nodes).toHaveLength(1)
    expect(reverted.nodes[0].type).toBe('DateOp')
    expect(reverted.nodes[0].id).toBe('/date-1')
  })

  it('preserves node data during revert', async () => {
    const project = createProjectWithDateTimeOp()
    const reverted = await down(project)

    expect(reverted.nodes[0].data.inputs.date).toBe('2024-01-01T00:00:00')
  })

  it('is reversible with up migration', async () => {
    const originalProject = createProjectWithDateOp()

    // Migrate up then down
    const migrated = await up(originalProject)
    const reverted = await down(migrated)

    // Should have original operator type back
    const dateNode = reverted.nodes.find(n => n.id === '/date-1')
    expect(dateNode?.type).toBe('DateOp')
    expect(dateNode?.data.inputs.date).toBe('2024-01-01T00:00:00')
  })

  it('handles projects without nodes', async () => {
    const project: NoodlesProjectJSON = {
      version: 8,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }

    const reverted = await down(project)
    expect(reverted.nodes).toEqual([])
  })
})
