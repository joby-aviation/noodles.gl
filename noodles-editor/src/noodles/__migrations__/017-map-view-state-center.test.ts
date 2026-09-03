import { describe, expect, it } from 'vitest'
import type { NoodlesProjectJSON } from '../utils/serialization'
import { down, up } from './017-map-view-state-center'

function makeProject(): NoodlesProjectJSON {
  return {
    version: 16,
    nodes: [
      {
        id: '/map',
        type: 'MapViewStateOp',
        position: { x: 0, y: 0 },
        data: {
          inputs: { longitude: 10, zoom: 4 },
          visibleInputs: ['longitude', 'latitude', 'zoom'],
        },
      },
      {
        id: '/lng',
        type: 'NumberOp',
        position: { x: -100, y: 0 },
        data: { inputs: { val: 20 } },
      },
    ],
    edges: [
      {
        id: '/lng.out.val->/map.par.longitude',
        source: '/lng',
        sourceHandle: 'out.val',
        target: '/map',
        targetHandle: 'par.longitude',
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    timeline: {
      sheetsById: {
        Noodles: {
          staticOverrides: {
            byObject: { map: { longitude: 10, latitude: 30, zoom: 4 } },
          },
          sequence: {
            length: 10,
            subUnitsPerUnit: 30,
            tracksByObject: {
              map: {
                trackIdByPropPath: {
                  '["longitude"]': 'lng-track',
                  latitude: 'lat-track',
                },
                trackData: {
                  'lng-track': {
                    type: 'number',
                    __debugName: 'map:["longitude"]',
                    keyframes: [],
                  },
                  'lat-track': { type: 'number', keyframes: [] },
                },
              },
            },
            markers: [
              {
                id: 'marker',
                position: 1,
                connections: [
                  { keyframeId: 'kf', trackPath: 'map / longitude', offset: 0 },
                ],
              },
            ],
          },
        },
      },
    },
  } as NoodlesProjectJSON
}

describe('017-map-view-state-center', () => {
  it('migrates values, handles, visibility, and port mode', async () => {
    const migrated = await up(makeProject())
    const node = migrated.nodes.find(candidate => candidate.id === '/map')!

    expect(node.data).toMatchObject({
      inputs: {
        center: { lng: 10, lat: 40.7128 },
        zoom: 4,
      },
      visibleInputs: ['center', 'zoom'],
      inputPortModes: { center: 'channels' },
    })
    expect(migrated.edges[0]).toMatchObject({
      id: '/lng.out.val->/map.par.center.lng',
      targetHandle: 'par.center.lng',
    })
  })

  it('migrates timeline tracks, debug names, overrides, and markers', async () => {
    const migrated = await up(makeProject())
    const timeline = migrated.timeline as any
    const object = timeline.sheetsById.Noodles.sequence.tracksByObject.map

    expect(object.trackIdByPropPath).toEqual({
      '["center","lng"]': 'lng-track',
      'center / lat': 'lat-track',
    })
    expect(object.trackData['lng-track'].__debugName).toBe('map:["center","lng"]')
    expect(timeline.sheetsById.Noodles.staticOverrides.byObject.map).toEqual({
      center: { lng: 10, lat: 30 },
      zoom: 4,
    })
    expect(timeline.sheetsById.Noodles.sequence.markers[0].connections[0].trackPath).toBe(
      'map / center / lng'
    )
  })

  it('supports a down migration back to scalar map coordinates', async () => {
    const downgraded = await down(await up(makeProject()))
    const node = downgraded.nodes.find(candidate => candidate.id === '/map')!
    const timeline = downgraded.timeline as any

    expect(node.data.inputs).toMatchObject({ longitude: 10, latitude: 40.7128, zoom: 4 })
    expect(node.data.inputPortModes).toBeUndefined()
    expect(downgraded.edges[0].targetHandle).toBe('par.longitude')
    expect(timeline.sheetsById.Noodles.sequence.tracksByObject.map.trackIdByPropPath).toEqual({
      '["longitude"]': 'lng-track',
      latitude: 'lat-track',
    })
  })
})
