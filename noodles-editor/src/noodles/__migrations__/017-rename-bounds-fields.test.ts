import { describe, expect, it } from 'vitest'
import type { NoodlesProjectJSON } from '../utils/serialization'
import { down, up } from './017-rename-bounds-fields'

describe('017-rename-bounds-fields', () => {
  const baseProject: NoodlesProjectJSON = {
    version: 16,
    timeline: {},
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  }

  it('should rename point1/point2 to southwest/northeast', async () => {
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
              point1: { lng: -74, lat: 40 },
              point2: { lng: -73, lat: 41 },
            },
          },
        },
        {
          id: '/out',
          type: 'OutOp',
          position: { x: 200, y: 0 },
          data: {},
        },
      ],
      edges: [
        {
          id: '/point-sw.out.point->/bounds.par.point1',
          source: '/point-sw',
          sourceHandle: 'out.point',
          target: '/bounds',
          targetHandle: 'par.point1',
        },
        {
          id: '/point-ne.out.point->/bounds.par.point2',
          source: '/point-ne',
          sourceHandle: 'out.point',
          target: '/bounds',
          targetHandle: 'par.point2',
        },
        {
          id: '/bounds.out.bounds->/out.par.data',
          source: '/bounds',
          sourceHandle: 'out.bounds',
          target: '/out',
          targetHandle: 'par.data',
        },
      ],
    }

    const migrated = await up(project)

    // Check that node data was updated
    const boundsNode = migrated.nodes.find(n => n.id === '/bounds')
    expect(boundsNode?.data.inputs).toEqual({
      southwest: { lng: -74, lat: 40 },
      northeast: { lng: -73, lat: 41 },
    })

    // Check edges were updated
    const southwestEdge = migrated.edges.find(e => e.targetHandle === 'par.southwest')
    expect(southwestEdge).toBeDefined()
    expect(southwestEdge?.id).toBe('/point-sw.out.point->/bounds.par.southwest')

    const northeastEdge = migrated.edges.find(e => e.targetHandle === 'par.northeast')
    expect(northeastEdge).toBeDefined()
    expect(northeastEdge?.id).toBe('/point-ne.out.point->/bounds.par.northeast')
  })

  it('should handle projects without BoundsOp nodes', async () => {
    const project: NoodlesProjectJSON = {
      ...baseProject,
      nodes: [
        {
          id: '/number',
          type: 'NumberOp',
          position: { x: 0, y: 0 },
          data: { inputs: { value: 42 } },
        },
      ],
    }

    const migrated = await up(project)
    expect(migrated).toEqual(project)
  })

  it('should reverse the migration', async () => {
    const migratedProject: NoodlesProjectJSON = {
      ...baseProject,
      version: 17,
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

    const reverted = await down(migratedProject)

    const boundsNode = reverted.nodes.find(n => n.id === '/bounds')
    expect(boundsNode?.data.inputs).toEqual({
      point1: { lng: -74, lat: 40 },
      point2: { lng: -73, lat: 41 },
    })

    // Check edges were updated
    const point1Edge = reverted.edges.find(e => e.targetHandle === 'par.point1')
    expect(point1Edge).toBeDefined()
    expect(point1Edge?.id).toBe('/point-sw.out.point->/bounds.par.point1')

    const point2Edge = reverted.edges.find(e => e.targetHandle === 'par.point2')
    expect(point2Edge).toBeDefined()
    expect(point2Edge?.id).toBe('/point-ne.out.point->/bounds.par.point2')
  })
})
