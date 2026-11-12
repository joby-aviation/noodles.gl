import type { EditorDoc } from '@noodles.gl/planner'
import { afterEach, describe, expect, it } from 'vitest'
import { useTimelineStore } from '../timeline/timeline-store'
import { setKey } from './doc-ops'
import { DocStore } from './doc-store'
import { bindTimeline, resetTimelinePanel, trackLabel } from './doc-timeline'

const doc = (): EditorDoc => ({
  version: 1,
  name: 'keys',
  nodes: [{ id: '/dots', op: 'scatter', name: 'dots', x: 0, y: 0, params: {} }],
  edges: [],
  timeline: {
    length: 4,
    fps: 24,
    tracks: [
      {
        target: '/dots.opacity',
        keyframes: [
          { id: 'a', time: 0, value: 0, interpolation: 'linear' },
          { id: 'b', time: 2, value: 1, interpolation: 'linear' },
        ],
      },
    ],
  },
})

let unbind: (() => void) | undefined
afterEach(() => {
  unbind?.()
  resetTimelinePanel()
})

describe('bindTimeline', () => {
  it("shows the document's tracks in the panel, by node name", () => {
    const store = new DocStore(doc())
    unbind = bindTimeline(store)
    const panel = useTimelineStore.getState()
    expect([...panel.tracks.keys()]).toEqual(['dots / opacity'])
    expect(panel.tracks.get('dots / opacity')?.keyframes.map(k => k.position)).toEqual([0, 2])
    expect(panel.sequence).toMatchObject({ length: 4, fps: 24 })
    expect(store.get().dirty).toBe(false)
  })

  it('writes a keyframe moved in the panel back to the document, one undo step', () => {
    const store = new DocStore(doc())
    unbind = bindTimeline(store)
    useTimelineStore.getState().moveKeyframe('dots / opacity', 'b', 3)
    expect(store.get().doc.timeline?.tracks[0].keyframes.map(k => k.time)).toEqual([0, 3])
    store.undo()
    expect(useTimelineStore.getState().tracks.get('dots / opacity')?.keyframes[1].position).toBe(2)
  })

  it('follows a document edit: keying a parameter adds its track', () => {
    const store = new DocStore(doc())
    unbind = bindTimeline(store)
    store.edit(d => setKey(d, '/dots.radiusScale', 1, 5))
    expect(useTimelineStore.getState().tracks.has('dots / radiusScale')).toBe(true)
  })
})

describe('trackLabel', () => {
  const doc = {
    version: 1 as const,
    name: 'l',
    nodes: [{ id: 'n1', op: 'table', name: 'cities', x: 0, y: 0, params: {} }],
    edges: [],
  }

  it('names a table cell by its column and 1-based row', () => {
    expect(trackLabel(doc, 'n1.rows.0.population')).toBe('cities / population (row 1)')
    expect(trackLabel(doc, 'n1.rows.2.properties.name')).toBe('cities / properties.name (row 3)')
  })

  it('names any other track by its parameter', () => {
    expect(trackLabel(doc, 'n1.opacity')).toBe('cities / opacity')
  })
})
