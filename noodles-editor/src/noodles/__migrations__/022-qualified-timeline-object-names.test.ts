import { describe, expect, it } from 'vitest'
import type { NoodlesProjectJSON } from '../utils/serialization'
import { down, up } from './022-qualified-timeline-object-names'

const track = (value: number) => ({
  type: 'number',
  keyframes: [{ id: `kf-${value}`, position: 0, value }],
})

function projectWithSequence(sequence: Record<string, unknown>): NoodlesProjectJSON {
  return {
    version: 21,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    timeline: {
      sheetsById: { Noodles: { sequence: { length: 10, subUnitsPerUnit: 30, ...sequence } } },
    },
  }
}

const getSequence = (project: NoodlesProjectJSON) =>
  (project.timeline as any).sheetsById.Noodles.sequence

describe('022-qualified-timeline-object-names', () => {
  it('renames operator-ID objects to timeline object names', async () => {
    const project = projectWithSequence({
      tracksByObject: {
        '/camera/camera-1': {
          trackIdByPropPath: { '["longitude"]': 't1' },
          trackData: { t1: track(1) },
        },
        '/trips-layer': {
          trackIdByPropPath: { '["opacity"]': 't2' },
          trackData: { t2: track(2) },
        },
        'number-1': {
          trackIdByPropPath: { '["value"]': 't3' },
          trackData: { t3: track(3) },
        },
      },
    })

    const tracksByObject = getSequence(await up(project)).tracksByObject

    expect(Object.keys(tracksByObject).sort()).toEqual([
      'camera / camera-1',
      'number-1',
      'trips-layer',
    ])
    expect(tracksByObject['camera / camera-1']).toEqual({
      trackIdByPropPath: { '["longitude"]': 't1' },
      trackData: { t1: track(1) },
    })
  })

  it('keeps existing tracks when a renamed object already exists', async () => {
    const project = projectWithSequence({
      tracksByObject: {
        '/camera': {
          trackIdByPropPath: { '["zoom"]': 't1', '["pitch"]': 't2' },
          trackData: { t1: track(1), t2: track(2) },
        },
        camera: {
          trackIdByPropPath: { '["zoom"]': 't1' },
          trackData: { t1: track(10) },
        },
      },
    })

    const tracksByObject = getSequence(await up(project)).tracksByObject

    expect(Object.keys(tracksByObject)).toEqual(['camera'])
    const { trackIdByPropPath, trackData } = tracksByObject.camera
    expect(trackData[trackIdByPropPath['["zoom"]']]).toEqual(track(10))
    expect(trackData[trackIdByPropPath['["pitch"]']]).toEqual(track(2))
  })

  it('renames marker track paths', async () => {
    const project = projectWithSequence({
      tracksByObject: { '/camera/camera-1': { trackIdByPropPath: {}, trackData: {} } },
      markers: [
        {
          id: 'tm_1',
          position: 2,
          connections: [
            { keyframeId: 'kf-1', trackPath: '/camera/camera-1 / longitude', offset: 0 },
            { keyframeId: 'kf-2', trackPath: 'number-1 / value', offset: 0.5 },
          ],
        },
      ],
    })

    const [marker] = getSequence(await up(project)).markers

    expect(marker.connections.map((c: { trackPath: string }) => c.trackPath)).toEqual([
      'camera / camera-1 / longitude',
      'number-1 / value',
    ])
  })

  it('returns projects without operator-ID objects unchanged', async () => {
    const project = projectWithSequence({
      tracksByObject: { camera: { trackIdByPropPath: {}, trackData: {} } },
    })
    expect(await up(project)).toBe(project)

    const noTimeline = { ...project, timeline: undefined }
    expect(await up(noTimeline)).toBe(noTimeline)
  })

  it('leaves the project unchanged when migrating down', async () => {
    const project = projectWithSequence({ tracksByObject: {} })
    expect(await down(project)).toBe(project)
  })
})
