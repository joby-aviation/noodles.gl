import { describe, expect, it } from 'vitest'
import type { NoodlesProjectJSON } from '../utils/serialization'
import { down, up } from './019-rename-bounds-literal-inputs'

describe('019-rename-bounds-literal-inputs', () => {
  const baseProject: NoodlesProjectJSON = {
    version: 18,
    timeline: {},
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  }

  it('should rename literal point1/point2 inputs to southwest/northeast', async () => {
    const project: NoodlesProjectJSON = {
      ...baseProject,
      nodes: [
        {
          id: '/bounds',
          type: 'BoundsOp',
          position: { x: 0, y: 0 },
          data: {
            inputs: {
              point1: [-74.05, 40.68],
              point2: [-73.9, 40.82],
            },
            locked: false,
          },
        },
      ],
    }

    const migrated = await up(project)

    const boundsNode = migrated.nodes.find(n => n.id === '/bounds')
    expect(boundsNode?.data).toEqual({
      inputs: {
        southwest: [-74.05, 40.68],
        northeast: [-73.9, 40.82],
      },
      locked: false,
    })
  })

  it('should leave an edge-connected BoundsOp migrated by 017 unchanged', async () => {
    const project: NoodlesProjectJSON = {
      ...baseProject,
      nodes: [
        {
          id: '/point-sw',
          type: 'PointOp',
          position: { x: 0, y: 0 },
          data: {},
        },
        {
          id: '/point-ne',
          type: 'PointOp',
          position: { x: 0, y: 50 },
          data: {},
        },
        {
          id: '/bounds',
          type: 'BoundsOp',
          position: { x: 100, y: 0 },
          data: {
            inputs: {
              southwest: { lng: -74, lat: 40 },
              northeast: { lng: -73, lat: 41 },
            },
          },
        },
      ],
      edges: [
        {
          id: '/point-sw.out.point->/bounds.par.southwest',
          source: '/point-sw',
          sourceHandle: 'out.point',
          target: '/bounds',
          targetHandle: 'par.southwest',
        },
        {
          id: '/point-ne.out.point->/bounds.par.northeast',
          source: '/point-ne',
          sourceHandle: 'out.point',
          target: '/bounds',
          targetHandle: 'par.northeast',
        },
      ],
    }

    const migrated = await up(project)
    expect(migrated).toEqual(project)
  })

  it('should not overwrite a new key that is already present', async () => {
    const project: NoodlesProjectJSON = {
      ...baseProject,
      nodes: [
        {
          id: '/bounds',
          type: 'BoundsOp',
          position: { x: 0, y: 0 },
          data: {
            inputs: {
              point1: [0, 0],
              southwest: [-74.05, 40.68],
              point2: [-73.9, 40.82],
            },
          },
        },
      ],
    }

    const migrated = await up(project)

    const boundsNode = migrated.nodes.find(n => n.id === '/bounds')
    expect(boundsNode?.data.inputs).toEqual({
      point1: [0, 0],
      southwest: [-74.05, 40.68],
      northeast: [-73.9, 40.82],
    })
  })

  it('should only touch BoundsOp nodes', async () => {
    const project: NoodlesProjectJSON = {
      ...baseProject,
      nodes: [
        {
          id: '/code',
          type: 'CodeOp',
          position: { x: 0, y: 0 },
          data: { inputs: { point1: 1, point2: 2 } },
        },
      ],
    }

    const migrated = await up(project)
    expect(migrated).toEqual(project)
  })

  it('should reverse the migration', async () => {
    const migratedProject: NoodlesProjectJSON = {
      ...baseProject,
      version: 19,
      nodes: [
        {
          id: '/bounds',
          type: 'BoundsOp',
          position: { x: 0, y: 0 },
          data: {
            inputs: {
              southwest: [-74.05, 40.68],
              northeast: [-73.9, 40.82],
            },
          },
        },
      ],
    }

    const reverted = await down(migratedProject)

    const boundsNode = reverted.nodes.find(n => n.id === '/bounds')
    expect(boundsNode?.data.inputs).toEqual({
      point1: [-74.05, 40.68],
      point2: [-73.9, 40.82],
    })
  })
})
