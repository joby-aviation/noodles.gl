import { beforeEach, describe, expect, it } from 'vitest'
import { getTimelineStore } from '../../timeline/timeline-store'
import type { TimelineData } from '../../timeline/types'
import { useUIStore } from '../store'
import { expandTimelineIfAnimated } from './timeline-panel'

const animatedTimeline = {
  sheetsById: {
    Noodles: {
      sequence: {
        subUnitsPerUnit: 30,
        length: 20,
        tracksByObject: {
          'maplibre-basemap': {
            trackData: {
              bearing: {
                type: 'BasicKeyframedTrack',
                keyframes: [
                  { id: 'a', position: 0, connectedRight: true, handles: [0, 0, 1, 1], value: 0 },
                  {
                    id: 'b',
                    position: 20,
                    connectedRight: false,
                    handles: [0, 0, 1, 1],
                    value: 360,
                  },
                ],
              },
            },
            trackIdByPropPath: { '["viewState","bearing"]': 'bearing' },
          },
        },
      },
    },
  },
} as unknown as TimelineData

const staticTimeline = {
  sheetsById: { Noodles: { staticOverrides: { byObject: {} } } },
} as unknown as TimelineData

describe('expandTimelineIfAnimated', () => {
  beforeEach(() => {
    getTimelineStore().reset()
    useUIStore.getState().setTimelineExpanded(false)
  })

  it('opens the timeline when the project has keyframes', () => {
    getTimelineStore().fromTimelineJSON(animatedTimeline)
    expandTimelineIfAnimated()
    expect(useUIStore.getState().timelineExpanded).toBe(true)
  })

  it('leaves the timeline collapsed when the project has no keyframes', () => {
    getTimelineStore().fromTimelineJSON(staticTimeline)
    expandTimelineIfAnimated()
    expect(useUIStore.getState().timelineExpanded).toBe(false)
  })

  it('does not collapse an open timeline for a project without keyframes', () => {
    useUIStore.getState().setTimelineExpanded(true)
    getTimelineStore().fromTimelineJSON(staticTimeline)
    expandTimelineIfAnimated()
    expect(useUIStore.getState().timelineExpanded).toBe(true)
  })
})
