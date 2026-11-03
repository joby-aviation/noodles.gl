import { describe, expect, it } from 'vitest'
import type { NoodlesProjectJSON } from '../utils/serialization'
import { down, up } from './023-map-view-state-center'

type ProjectNode = NoodlesProjectJSON['nodes'][number]

function cameraNode(id: string, data: Record<string, unknown>): ProjectNode {
  return { id, type: 'MapViewStateOp', position: { x: 0, y: 0 }, data }
}

function project(
  nodes: ProjectNode[],
  edges: NoodlesProjectJSON['edges'] = [],
  timeline: Record<string, unknown> = {}
): NoodlesProjectJSON {
  return { version: 21, nodes, edges, timeline }
}

function edge(source: string, sourceHandle: string, target: string, targetHandle: string) {
  return {
    id: `${source}.${sourceHandle}->${target}.${targetHandle}`,
    source,
    sourceHandle,
    target,
    targetHandle,
  }
}

function timeline(trackIdByPropPath: Record<string, string>, trackPath: string) {
  return {
    sheetsById: {
      Noodles: {
        sequence: {
          length: 10,
          subUnitsPerUnit: 30,
          tracksByObject: { camera: { trackIdByPropPath, trackData: { t1: {}, t2: {} } } },
          markers: [{ id: 'm', position: 1, connections: [{ keyframeId: 'k', trackPath }] }],
        },
      },
    },
  }
}

const dataOf = (p: NoodlesProjectJSON, index = 0) =>
  p.nodes[index].data as Record<string, unknown> & { inputs: Record<string, unknown> }

describe('023-map-view-state-center', () => {
  it('moves longitude and latitude values into the center', async () => {
    const migrated = await up(
      project([
        cameraNode('/camera', {
          inputs: { longitude: 10, latitude: 20, zoom: 3 },
          visibleInputs: ['longitude', 'latitude', 'zoom'],
        }),
        cameraNode('/partial', { inputs: { latitude: 5 } }),
        cameraNode('/default', { inputs: { zoom: 4 } }),
      ])
    )
    expect(dataOf(migrated)).toEqual({
      inputs: { center: { lng: 10, lat: 20 }, zoom: 3 },
      visibleInputs: ['center', 'zoom'],
    })
    expect(dataOf(migrated, 1).inputs).toEqual({ center: { lng: -74.006, lat: 5 } })
    expect(dataOf(migrated, 2).inputs).toEqual({ zoom: 4 })
    // Literal values keep the center one port
    expect(dataOf(migrated).inputPortModes).toBeUndefined()
  })

  it('moves a longitude expression into its channel and splits the center', async () => {
    const migrated = await up(
      project([cameraNode('/camera', { inputs: { longitude: { $expr: 'time * 10' } } })])
    )
    expect(dataOf(migrated)).toEqual({
      inputs: { center: { lng: { $expr: 'time * 10' }, lat: 40.7128 } },
      inputPortModes: { center: 'channels' },
    })
  })

  it('moves a latitude expression into its channel and splits the center', async () => {
    const migrated = await up(
      project([
        cameraNode('/camera', {
          inputs: { longitude: 1, latitude: { $expr: "op('/lat').par.val" } },
        }),
      ])
    )
    expect(dataOf(migrated)).toEqual({
      inputs: { center: { lng: 1, lat: { $expr: "op('/lat').par.val" } } },
      inputPortModes: { center: 'channels' },
    })
  })

  it('moves connections to channel ports', async () => {
    const migrated = await up(
      project(
        [
          cameraNode('/camera', { inputs: { latitude: 5 } }),
          { id: '/num', type: 'NumberOp', position: { x: 0, y: 0 }, data: { inputs: {} } },
        ],
        [
          edge('/num', 'out.val', '/camera', 'par.longitude'),
          edge('/num', 'out.val', '/camera', 'par.zoom'),
        ]
      )
    )
    expect(migrated.edges.map(e => e.id)).toEqual([
      '/num.out.val->/camera.par.center.lng',
      '/num.out.val->/camera.par.zoom',
    ])
    expect(migrated.edges[0].targetHandle).toBe('par.center.lng')
    expect(dataOf(migrated).inputPortModes).toEqual({ center: 'channels' })
  })

  it('renames timeline tracks and marker connections', async () => {
    const migrated = await up(
      project(
        [cameraNode('/camera', { inputs: {} })],
        [],
        timeline({ longitude: 't1', '["latitude"]': 't2' }, 'camera / longitude')
      )
    )
    const sequence = (migrated.timeline as ReturnType<typeof timeline>).sheetsById.Noodles.sequence
    expect(sequence.tracksByObject.camera.trackIdByPropPath).toEqual({
      'center.lng': 't1',
      '["center","lat"]': 't2',
    })
    expect(sequence.markers[0].connections[0].trackPath).toBe('camera / center / lng')
  })

  it('renames the tracks of a camera inside a container', async () => {
    const nested = {
      sheetsById: {
        Noodles: {
          sequence: {
            tracksByObject: {
              scene: { trackIdByPropPath: { 'camera.latitude': 't1', 'other.latitude': 't2' } },
            },
          },
        },
      },
    }
    const migrated = await up(project([cameraNode('/scene/camera', {})], [], nested))
    const paths = (migrated.timeline as typeof nested).sheetsById.Noodles.sequence.tracksByObject
      .scene.trackIdByPropPath
    expect(paths).toEqual({ 'camera.center.lat': 't1', 'other.latitude': 't2' })
  })

  it('leaves projects without a MapViewStateOp alone', async () => {
    const original = project(
      [{ id: '/num', type: 'NumberOp', position: { x: 0, y: 0 }, data: { inputs: { val: 1 } } }],
      [edge('/a', 'out.val', '/num', 'par.longitude')],
      timeline({ longitude: 't1' }, 'num / longitude')
    )
    expect(await up(original)).toBe(original)
  })

  it('migrates a project file that has no timeline', async () => {
    const { timeline: _, ...noTimeline } = project([
      cameraNode('/camera', { inputs: { longitude: 1 } }),
    ])
    const migrated = await up(noTimeline as NoodlesProjectJSON)
    expect(dataOf(migrated).inputs).toEqual({ center: { lng: 1, lat: 40.7128 } })
    expect(migrated.timeline).toBeUndefined()
    expect((await down(migrated)).timeline).toBeUndefined()
  })

  it('reverses with down', async () => {
    const original = project(
      [
        cameraNode('/camera', {
          inputs: { longitude: { $expr: 'time' }, latitude: 2, zoom: 3 },
          visibleInputs: ['longitude', 'latitude'],
        }),
        { id: '/num', type: 'NumberOp', position: { x: 0, y: 0 }, data: { inputs: {} } },
      ],
      [edge('/num', 'out.val', '/camera', 'par.latitude')],
      timeline({ longitude: 't1' }, 'camera / longitude')
    )
    const restored = await down(await up(original))
    expect(restored.nodes[0].data).toEqual(original.nodes[0].data)
    expect(restored.edges).toEqual(original.edges)
    expect(restored.timeline).toEqual(original.timeline)
  })

  it('drops a whole-center connection and expression on the way down', async () => {
    const migrated = await down(
      project(
        [cameraNode('/camera', { inputs: { center: { $expr: 'point' } } })],
        [edge('/point', 'out.point', '/camera', 'par.center')]
      )
    )
    expect(dataOf(migrated).inputs).toEqual({})
    expect(migrated.edges).toEqual([])
  })
})
