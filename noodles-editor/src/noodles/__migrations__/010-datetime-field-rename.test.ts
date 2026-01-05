import { describe, expect, it } from 'vitest'
import type { NoodlesProjectJSON } from '../utils/serialization'
import { down, up } from './010-datetime-field-rename'

const createProjectWithOldDateTimeOp = (): NoodlesProjectJSON => ({
  version: 9,
  nodes: [
    {
      id: '/datetime-1',
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

const createProjectWithNewDateTimeOp = (): NoodlesProjectJSON => ({
  version: 10,
  nodes: [
    {
      id: '/datetime-1',
      type: 'DateTimeOp',
      position: { x: 100, y: 100 },
      data: {
        inputs: {
          datetime: '2024-01-01T00:00:00',
        },
      },
    },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  timeline: {},
})

const createProjectWithEdges = (): NoodlesProjectJSON => ({
  version: 9,
  nodes: [
    {
      id: '/datetime-1',
      type: 'DateTimeOp',
      position: { x: 100, y: 100 },
      data: {
        inputs: {
          date: '2024-01-01T00:00:00',
        },
      },
    },
    {
      id: '/datetime-2',
      type: 'DateTimeOp',
      position: { x: 200, y: 200 },
      data: {
        inputs: {
          date: '2024-12-31T23:59:59',
        },
      },
    },
    {
      id: '/number-1',
      type: 'NumberOp',
      position: { x: 300, y: 300 },
      data: {
        inputs: {
          value: 42,
        },
      },
    },
  ],
  edges: [
    {
      id: '/datetime-1.out.date->/datetime-2.par.date',
      source: '/datetime-1',
      target: '/datetime-2',
      sourceHandle: 'out.date',
      targetHandle: 'par.date',
    },
    {
      id: '/number-1.out.value->/datetime-1.par.other',
      source: '/number-1',
      target: '/datetime-1',
      sourceHandle: 'out.value',
      targetHandle: 'par.other',
    },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
  timeline: {},
})

const createProjectWithTimeline = (): NoodlesProjectJSON => ({
  version: 9,
  nodes: [
    {
      id: '/datetime-1',
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
  timeline: {
    definitionVersion: '0.4.0',
    sheetsById: {
      Noodles: {
        sequence: {
          tracksByObject: {
            '/datetime-1': {
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
})

describe('migration 010 up', () => {
  it('renames TimeOfDayOp to TimeOp', async () => {
    const project: NoodlesProjectJSON = {
      version: 9,
      nodes: [
        {
          id: '/time-1',
          type: 'TimeOfDayOp',
          position: { x: 100, y: 100 },
          data: {
            inputs: {
              time: '14:30:00',
            },
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }
    const migrated = await up(project)

    expect(migrated.nodes).toHaveLength(1)
    expect(migrated.nodes[0].type).toBe('TimeOp')
    expect(migrated.nodes[0].data.inputs.time).toBe('14:30:00')
  })

  it('renames TimeOp to AnimationTimeOp', async () => {
    const project: NoodlesProjectJSON = {
      version: 9,
      nodes: [
        {
          id: '/animation-time-1',
          type: 'TimeOp',
          position: { x: 100, y: 100 },
          data: {
            inputs: {},
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }
    const migrated = await up(project)

    expect(migrated.nodes).toHaveLength(1)
    expect(migrated.nodes[0].type).toBe('AnimationTimeOp')
  })

  it('renames date field to datetime in DateTimeOp', async () => {
    const project = createProjectWithOldDateTimeOp()
    const migrated = await up(project)

    expect(migrated.nodes).toHaveLength(1)
    expect(migrated.nodes[0].type).toBe('DateTimeOp')
    expect(migrated.nodes[0].data.inputs.datetime).toBe('2024-01-01T00:00:00')
    expect(migrated.nodes[0].data.inputs.date).toBeUndefined()
  })

  it('preserves node position and ID', async () => {
    const project = createProjectWithOldDateTimeOp()
    const migrated = await up(project)

    expect(migrated.nodes[0].position).toEqual({ x: 100, y: 100 })
    expect(migrated.nodes[0].id).toBe('/datetime-1')
  })

  it('updates edges that connect to DateTimeOp date fields', async () => {
    const project = createProjectWithEdges()
    const migrated = await up(project)

    // Find the edge between two DateTimeOps
    const dateTimeEdge = migrated.edges.find(e => e.source === '/datetime-1' && e.target === '/datetime-2')
    expect(dateTimeEdge).toBeDefined()
    expect(dateTimeEdge?.sourceHandle).toBe('out.datetime')
    expect(dateTimeEdge?.targetHandle).toBe('par.datetime')
    expect(dateTimeEdge?.id).toBe('/datetime-1.out.datetime->/datetime-2.par.datetime')

    // Non-DateTimeOp edges should be unchanged
    const numberEdge = migrated.edges.find(e => e.source === '/number-1')
    expect(numberEdge?.sourceHandle).toBe('out.value')
    expect(numberEdge?.targetHandle).toBe('par.other')
  })

  it('updates timeline keyframes for DateTimeOp nodes', async () => {
    const project = createProjectWithTimeline()
    const migrated = await up(project)

    const trackData = migrated.timeline.sheetsById?.Noodles?.sequence?.tracksByObject?.['/datetime-1']?.trackData
    expect(trackData).toBeDefined()
    expect(trackData?.datetime).toBeDefined()
    expect(trackData?.date).toBeUndefined()
    expect(trackData?.datetime).toEqual({
      type: 'BasicKeyframedTrack',
      keyframes: [
        { position: 0, value: '2024-01-01T00:00:00' },
        { position: 5, value: '2024-12-31T23:59:59' },
      ],
    })
  })

  it('handles multiple DateTimeOp nodes', async () => {
    const project = createProjectWithEdges()
    const migrated = await up(project)

    const datetime1 = migrated.nodes.find(n => n.id === '/datetime-1')
    const datetime2 = migrated.nodes.find(n => n.id === '/datetime-2')

    expect(datetime1?.data.inputs.datetime).toBe('2024-01-01T00:00:00')
    expect(datetime1?.data.inputs.date).toBeUndefined()

    expect(datetime2?.data.inputs.datetime).toBe('2024-12-31T23:59:59')
    expect(datetime2?.data.inputs.date).toBeUndefined()
  })

  it('leaves non-DateTimeOp nodes unchanged', async () => {
    const project = createProjectWithEdges()
    const migrated = await up(project)

    const numberNode = migrated.nodes.find(n => n.id === '/number-1')
    expect(numberNode?.type).toBe('NumberOp')
    expect(numberNode?.data.inputs.value).toBe(42)
  })

  it('handles projects without DateTimeOp nodes', async () => {
    const project: NoodlesProjectJSON = {
      version: 9,
      nodes: [
        {
          id: '/number-1',
          type: 'NumberOp',
          position: { x: 100, y: 100 },
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
    }

    const migrated = await up(project)
    expect(migrated.nodes).toEqual(project.nodes)
    expect(migrated.edges).toEqual(project.edges)
  })

  it('handles projects without timeline', async () => {
    const project = createProjectWithOldDateTimeOp()
    const migrated = await up(project)

    expect(migrated.timeline).toBeDefined()
  })
})

describe('migration 010 down', () => {
  it('reverts TimeOp to TimeOfDayOp', async () => {
    const project: NoodlesProjectJSON = {
      version: 10,
      nodes: [
        {
          id: '/time-1',
          type: 'TimeOp',
          position: { x: 100, y: 100 },
          data: {
            inputs: {
              time: '14:30:00',
            },
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }
    const reverted = await down(project)

    expect(reverted.nodes).toHaveLength(1)
    expect(reverted.nodes[0].type).toBe('TimeOfDayOp')
    expect(reverted.nodes[0].data.inputs.time).toBe('14:30:00')
  })

  it('reverts AnimationTimeOp to TimeOp', async () => {
    const project: NoodlesProjectJSON = {
      version: 10,
      nodes: [
        {
          id: '/animation-time-1',
          type: 'AnimationTimeOp',
          position: { x: 100, y: 100 },
          data: {
            inputs: {},
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }
    const reverted = await down(project)

    expect(reverted.nodes).toHaveLength(1)
    expect(reverted.nodes[0].type).toBe('TimeOp')
  })

  it('reverts datetime field to date in DateTimeOp', async () => {
    const project = createProjectWithNewDateTimeOp()
    const reverted = await down(project)

    expect(reverted.nodes).toHaveLength(1)
    expect(reverted.nodes[0].type).toBe('DateTimeOp')
    expect(reverted.nodes[0].data.inputs.date).toBe('2024-01-01T00:00:00')
    expect(reverted.nodes[0].data.inputs.datetime).toBeUndefined()
  })

  it('reverts edge handles', async () => {
    const project = createProjectWithEdges()
    const migrated = await up(project)
    const reverted = await down(migrated)

    const dateTimeEdge = reverted.edges.find(e => e.source === '/datetime-1' && e.target === '/datetime-2')
    expect(dateTimeEdge?.sourceHandle).toBe('out.date')
    expect(dateTimeEdge?.targetHandle).toBe('par.date')
    expect(dateTimeEdge?.id).toBe('/datetime-1.out.date->/datetime-2.par.date')
  })

  it('reverts timeline keyframes', async () => {
    const project = createProjectWithTimeline()
    const migrated = await up(project)
    const reverted = await down(migrated)

    const trackData = reverted.timeline.sheetsById?.Noodles?.sequence?.tracksByObject?.['/datetime-1']?.trackData
    expect(trackData?.date).toBeDefined()
    expect(trackData?.datetime).toBeUndefined()
  })

  it('is reversible with up migration', async () => {
    const originalProject = createProjectWithOldDateTimeOp()

    // Migrate up then down
    const migrated = await up(originalProject)
    const reverted = await down(migrated)

    expect(reverted.nodes[0].data.inputs.date).toBe('2024-01-01T00:00:00')
    expect(reverted.nodes[0].data.inputs.datetime).toBeUndefined()
  })
})
