import type { EditorDoc } from '@noodles.gl/planner'
import { beforeEach, describe, expect, it } from 'vitest'
import { useUIStore } from '../../editor/ui-store'
import { expandTimelineIfAnimated } from './timeline-panel'

const doc = (tracks: NonNullable<EditorDoc['timeline']>['tracks']): EditorDoc => ({
  version: 1,
  name: 'p',
  nodes: [],
  edges: [],
  timeline: { tracks },
})

const key = (time: number, value: number) => ({
  id: `k${time}`,
  time,
  value,
  interpolation: 'linear' as const,
})

describe('expandTimelineIfAnimated', () => {
  beforeEach(() => {
    useUIStore.getState().setTimelineExpanded(false)
  })

  it('opens the timeline when the document has keyframes', () => {
    expandTimelineIfAnimated(
      doc([{ target: 'deck.bearing', keyframes: [key(0, 0), key(20, 360)] }])
    )
    expect(useUIStore.getState().timelineExpanded).toBe(true)
  })

  it('leaves it closed when no track has a keyframe', () => {
    expandTimelineIfAnimated(doc([{ target: 'deck.bearing', keyframes: [] }]))
    expandTimelineIfAnimated({ version: 1, name: 'p', nodes: [], edges: [] })
    expect(useUIStore.getState().timelineExpanded).toBe(false)
  })

  it('never collapses an open timeline', () => {
    useUIStore.getState().setTimelineExpanded(true)
    expandTimelineIfAnimated(doc([]))
    expect(useUIStore.getState().timelineExpanded).toBe(true)
  })
})
