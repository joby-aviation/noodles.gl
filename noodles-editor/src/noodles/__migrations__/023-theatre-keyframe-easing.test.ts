import { describe, expect, it } from 'vitest'
import { evaluateTrack } from '../../timeline/interpolation'
import { useTimelineStore } from '../../timeline/timeline-store'
import type { NoodlesProjectJSON } from '../utils/serialization'
import { up } from './023-theatre-keyframe-easing'

const THEATRE_DEFAULT = [0.5, 1, 0.5, 0]

const keyframe = (
  position: number,
  value: number,
  handles = THEATRE_DEFAULT,
  extra: Record<string, unknown> = {}
) => ({
  id: `kf-${position}`,
  position,
  connectedRight: true,
  handles,
  type: 'bezier',
  value,
  ...extra,
})

function projectWithTracks(trackData: Record<string, unknown>): NoodlesProjectJSON {
  return {
    version: 22,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    timeline: {
      sheetsById: {
        Noodles: {
          sequence: {
            length: 10,
            subUnitsPerUnit: 30,
            tracksByObject: {
              number: {
                trackIdByPropPath: Object.fromEntries(
                  Object.keys(trackData).map(id => [`["${id}"]`, id])
                ),
                trackData,
              },
            },
          },
        },
      },
    },
  }
}

const keyframesOf = (project: NoodlesProjectJSON, id = 'value'): any[] =>
  (project.timeline as any).sheetsById.Noodles.sequence.tracksByObject.number.trackData[id]
    .keyframes

describe('023-theatre-keyframe-easing', () => {
  it("eases each segment with this keyframe's right handle and the next one's left", async () => {
    const project = projectWithTracks({
      value: {
        type: 'BasicKeyframedTrack',
        keyframes: [keyframe(0, 0, [0.1, 0.2, 0.3, 0.4]), keyframe(1, 1, [0.6, 0.7, 0.8, 0.9])],
      },
    })

    const [first, last] = keyframesOf(await up(project))

    expect(first.handles).toEqual([0.3, 0.4, 0.6, 0.7])
    // No outgoing segment, so its own left handle stands in for the next keyframe's
    expect(last.handles).toEqual([0.8, 0.9, 0.6, 0.7])
    expect(first).not.toHaveProperty('type')
    expect(last).not.toHaveProperty('type')
  })

  it("plays Theatre's default handles as ease-in-out", async () => {
    const project = projectWithTracks({
      value: { type: 'BasicKeyframedTrack', keyframes: [keyframe(0, 0), keyframe(1, 100)] },
    })
    const evaluateAt = (time: number) => {
      const track = useTimelineStore.getState().tracks.get('number / value')
      if (!track) throw new Error('track did not load')
      return evaluateTrack(track, time) as number
    }

    useTimelineStore.getState().fromTimelineJSON(project.timeline)
    // cubic-bezier(0.5, 1, 0.5, 0) covers 39% of the change in the first quarter
    expect(evaluateAt(0.25)).toBeGreaterThan(35)

    useTimelineStore.getState().fromTimelineJSON((await up(project)).timeline)
    expect(evaluateAt(0.25)).toBeLessThan(20)
    expect(evaluateAt(0.5)).toBeCloseTo(50)
    expect(evaluateAt(0.75)).toBeGreaterThan(80)
  })

  it('turns hold keyframes into keyframes that are not connected right', async () => {
    const project = projectWithTracks({
      value: {
        type: 'BasicKeyframedTrack',
        keyframes: [
          keyframe(0, 0, THEATRE_DEFAULT, { type: 'hold' }),
          keyframe(1, 1, THEATRE_DEFAULT, { connectedRight: false }),
          keyframe(2, 2),
        ],
      },
    })

    const keyframes = keyframesOf(await up(project))

    expect(keyframes.map(kf => kf.connectedRight)).toEqual([false, false, true])
  })

  it('pairs keyframes by position when they are saved out of order', async () => {
    const project = projectWithTracks({
      value: {
        type: 'BasicKeyframedTrack',
        keyframes: [keyframe(2, 2, [0.6, 0.7, 0.8, 0.9]), keyframe(0, 0, [0.1, 0.2, 0.3, 0.4])],
      },
    })

    const keyframes = keyframesOf(await up(project))

    expect(keyframes.map(kf => kf.position)).toEqual([0, 2])
    expect(keyframes[0].handles).toEqual([0.3, 0.4, 0.6, 0.7])
  })

  it('leaves keyframes saved by the native timeline unchanged', async () => {
    const native = {
      id: 'kf-0',
      position: 0,
      connectedRight: true,
      handles: [0, 0, 1, 1],
      value: 0,
    }
    const project = projectWithTracks({
      value: { type: 'BasicKeyframedTrack', keyframes: [native, { ...native, position: 1 }] },
    })

    expect(await up(project)).toBe(project)
  })

  it('converts only the tracks Theatre wrote', async () => {
    const native = {
      id: 'kf-0',
      position: 0,
      connectedRight: true,
      handles: [0, 0, 1, 1],
      value: 0,
    }
    const project = projectWithTracks({
      value: { type: 'BasicKeyframedTrack', keyframes: [keyframe(0, 0), keyframe(1, 1)] },
      native: { type: 'BasicKeyframedTrack', keyframes: [native] },
    })

    const migrated = await up(project)

    expect(keyframesOf(migrated, 'native')).toEqual([native])
    expect(keyframesOf(migrated)[0].handles).toEqual([0.5, 0, 0.5, 1])
    // Converted keyframes lose `type`, so a second run changes nothing
    expect(await up(migrated)).toBe(migrated)
  })

  it('returns projects without a timeline unchanged', async () => {
    const project: NoodlesProjectJSON = {
      version: 22,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }

    expect(await up(project)).toBe(project)
  })
})
