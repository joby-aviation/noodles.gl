import { describe, expect, it } from 'vitest'
import type { NoodlesProjectJSON } from '../utils/serialization'
import { down, up } from './006-rename-nodes-to-noodles'

const createProjectWithNodesSheet = (): NoodlesProjectJSON => ({
  version: 5,
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  timeline: {
    sheetsById: {
      Nodes: {
        staticOverrides: {
          byObject: {
            'test-node': {
              field: {
                type: 'string',
                value: 'test',
              },
            },
          },
        },
        sequence: {
          tracksByObject: {},
        },
      },
    },
    definitionVersion: '0.4.0',
  },
})

const createProjectWithNoodlesSheet = (): NoodlesProjectJSON => ({
  version: 6,
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  timeline: {
    sheetsById: {
      Noodles: {
        staticOverrides: {
          byObject: {
            'test-node': {
              field: {
                type: 'string',
                value: 'test',
              },
            },
          },
        },
        sequence: {
          tracksByObject: {},
        },
      },
    },
    definitionVersion: '0.4.0',
  },
})

describe('migration 006 up', () => {
  it('renames "Nodes" sheet to "Noodles"', async () => {
    const project = createProjectWithNodesSheet()
    const migrated = await up(project)

    expect(migrated.timeline.sheetsById).toBeDefined()
    expect(migrated.timeline.sheetsById.Noodles).toBeDefined()
    expect(migrated.timeline.sheetsById.Nodes).toBeUndefined()
  })

  it('preserves sheet data during rename', async () => {
    const project = createProjectWithNodesSheet()
    const migrated = await up(project)

    const noodlesSheet = migrated.timeline.sheetsById.Noodles as any
    expect(noodlesSheet.staticOverrides.byObject['test-node'].field.value).toBe('test')
    expect(noodlesSheet.sequence.tracksByObject).toEqual({})
  })

  it('preserves other timeline properties', async () => {
    const project = createProjectWithNodesSheet()
    const migrated = await up(project)

    expect(migrated.timeline.definitionVersion).toBe('0.4.0')
  })

  it('handles projects without timeline', async () => {
    const project: NoodlesProjectJSON = {
      version: 5,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }

    const migrated = await up(project)
    expect(migrated).toEqual(project)
  })

  it('handles projects without sheetsById', async () => {
    const project: NoodlesProjectJSON = {
      version: 5,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {
        definitionVersion: '0.4.0',
      },
    }

    const migrated = await up(project)
    expect(migrated).toEqual(project)
  })

  it('handles projects without "Nodes" sheet', async () => {
    const project: NoodlesProjectJSON = {
      version: 5,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {
        sheetsById: {
          SomeOtherSheet: {},
        },
        definitionVersion: '0.4.0',
      },
    }

    const migrated = await up(project)
    expect(migrated).toEqual(project)
  })

  it('handles projects with both "Nodes" and other sheets', async () => {
    const project: NoodlesProjectJSON = {
      version: 5,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {
        sheetsById: {
          Nodes: { data: 'test' },
          OtherSheet: { data: 'other' },
        },
        definitionVersion: '0.4.0',
      },
    }

    const migrated = await up(project)
    expect(migrated.timeline.sheetsById.Noodles).toEqual({ data: 'test' })
    expect(migrated.timeline.sheetsById.OtherSheet).toEqual({ data: 'other' })
    expect(migrated.timeline.sheetsById.Nodes).toBeUndefined()
  })
})

describe('migration 006 down', () => {
  it('renames "Noodles" sheet back to "Nodes"', async () => {
    const project = createProjectWithNoodlesSheet()
    const reverted = await down(project)

    expect(reverted.timeline.sheetsById).toBeDefined()
    expect(reverted.timeline.sheetsById.Nodes).toBeDefined()
    expect(reverted.timeline.sheetsById.Noodles).toBeUndefined()
  })

  it('preserves sheet data during rename', async () => {
    const project = createProjectWithNoodlesSheet()
    const reverted = await down(project)

    const nodesSheet = reverted.timeline.sheetsById.Nodes as any
    expect(nodesSheet.staticOverrides.byObject['test-node'].field.value).toBe('test')
    expect(nodesSheet.sequence.tracksByObject).toEqual({})
  })

  it('preserves other timeline properties', async () => {
    const project = createProjectWithNoodlesSheet()
    const reverted = await down(project)

    expect(reverted.timeline.definitionVersion).toBe('0.4.0')
  })

  it('handles projects without timeline', async () => {
    const project: NoodlesProjectJSON = {
      version: 6,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {},
    }

    const reverted = await down(project)
    expect(reverted).toEqual(project)
  })

  it('handles projects without sheetsById', async () => {
    const project: NoodlesProjectJSON = {
      version: 6,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {
        definitionVersion: '0.4.0',
      },
    }

    const reverted = await down(project)
    expect(reverted).toEqual(project)
  })

  it('handles projects without "Noodles" sheet', async () => {
    const project: NoodlesProjectJSON = {
      version: 6,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      timeline: {
        sheetsById: {
          SomeOtherSheet: {},
        },
        definitionVersion: '0.4.0',
      },
    }

    const reverted = await down(project)
    expect(reverted).toEqual(project)
  })

  it('is reversible with up migration', async () => {
    const originalProject = createProjectWithNodesSheet()

    // Migrate up then down
    const migrated = await up(originalProject)
    const reverted = await down(migrated)

    // Should have "Nodes" sheet back with same data
    expect(reverted.timeline.sheetsById.Nodes).toBeDefined()
    expect(reverted.timeline.sheetsById.Nodes).toEqual(originalProject.timeline.sheetsById.Nodes)
  })
})
