import { type EditorDoc, OPERATOR_INDEX } from '@noodles.gl/planner'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeCamera, writesStatic } from './camera-control'
import { docStore } from './doc-store'
import { NodeFields } from './field-adapter'
import { ParamRow } from './param-row'
import { pendingKeys } from './pending-keys'

// A deck whose zoom is keyframed and whose other camera parameters are static
const doc = (): EditorDoc => ({
  version: 1,
  name: 'pending',
  nodes: [{ id: 'map', op: 'deck', x: 0, y: 0, params: { longitude: -120 } }],
  edges: [],
  timeline: {
    tracks: [
      {
        target: 'map.zoom',
        keyframes: [{ id: 'k1', time: 0, value: 4, interpolation: 'bezier' }],
      },
    ],
  } as EditorDoc['timeline'],
})

const view = { longitude: -118, latitude: 34, zoom: 9, pitch: 20, bearing: 5 }

beforeEach(() => {
  docStore().load(doc())
  pendingKeys().clear()
})
afterEach(() => cleanup())

describe('writing a locked camera', () => {
  it('changes static parameters and holds keyframed ones back, unkeyed', () => {
    const d = doc()
    expect(writeCamera(d, 'map', view)).toEqual({ changed: { 'map.zoom': 9 }, same: [] })
    expect(d.nodes[0].params).toMatchObject({ longitude: -118, latitude: 34, pitch: 20 })
    expect(d.timeline?.tracks[0].keyframes).toEqual([
      expect.objectContaining({ time: 0, value: 4 }),
    ])
  })

  it('holds no change for a keyframed parameter the move left where it was keyed', () => {
    // A pan: zoom comes back as keyed, with float noise
    const pan = { ...view, zoom: 4.0000000001 }
    expect(writeCamera(doc(), 'map', pan, { zoom: 4 })).toEqual({ changed: {}, same: ['map.zoom'] })
  })

  it('needs no undo step when every camera parameter is keyframed', () => {
    const d = doc()
    expect(writesStatic(d, 'map')).toBe(true)
    d.timeline = {
      tracks: ['longitude', 'latitude', 'zoom', 'pitch', 'bearing'].map(p => ({
        target: `map.${p}`,
        keyframes: [],
      })),
    } as unknown as EditorDoc['timeline']
    expect(writesStatic(d, 'map')).toBe(false)
  })
})

describe('a changed keyframed parameter in Properties', () => {
  const zoomRow = () => {
    const node = docStore().get().doc.nodes[0]
    const def = OPERATOR_INDEX.get('deck')?.params.find(p => p.name === 'zoom')
    const fields = new NodeFields(docStore(), node)
    const b = def && fields.bindings.get('zoom')
    if (!def || !b) throw new Error('no zoom parameter')
    return render(<ParamRow node={node} def={def} field={b.field} wired={false} />)
  }

  it('is marked changed, shows the new value, and its keyframe button keys it', () => {
    pendingKeys().set(docStore().get().doc, { 'map.zoom': 9 })
    const { container, getByText } = zoomRow()
    const row = container.querySelector('[data-field-row]') as HTMLElement
    expect(row.className).toMatch(/paramChanged/)
    expect(getByText('9')).toBeTruthy()

    fireEvent.click(container.querySelector('button[title^="Changed to 9"]') as HTMLElement)
    // Keyed over the keyframe at the playhead, not removed
    expect(docStore().get().doc.timeline?.tracks[0].keyframes).toEqual([
      expect.objectContaining({ time: 0, value: 9 }),
    ])
    expect(pendingKeys().values).toEqual({})
  })

  it('is not marked once its change is dropped', () => {
    pendingKeys().set(docStore().get().doc, { 'map.zoom': 9 })
    pendingKeys().clear()
    const { container } = zoomRow()
    expect((container.querySelector('[data-field-row]') as HTMLElement).className).not.toMatch(
      /paramChanged/
    )
  })
})

describe('a change and later edits to its keyframes', () => {
  it('is dropped when the keyframes change, or the track goes', () => {
    pendingKeys().set(docStore().get().doc, { 'map.zoom': 9 })
    pendingKeys().reconcile(docStore().get().doc)
    expect(pendingKeys().values).toEqual({ 'map.zoom': 9 })

    // Typing 5 into the keyframed Zoom keys 5 at the playhead
    docStore().edit(d => {
      const k = d.timeline?.tracks[0].keyframes[0]
      if (k) k.value = 5
    })
    pendingKeys().reconcile(docStore().get().doc)
    expect(pendingKeys().values).toEqual({})

    pendingKeys().set(docStore().get().doc, { 'map.zoom': 9 })
    docStore().edit(d => {
      if (d.timeline) d.timeline.tracks = []
    })
    pendingKeys().reconcile(docStore().get().doc)
    expect(pendingKeys().values).toEqual({})
  })
})
