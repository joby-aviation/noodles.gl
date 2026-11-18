// The next step the bar suggests, from where the project is (#787)
import type { EditorDoc } from '@noodles.gl/planner'
import { describe, expect, it } from 'vitest'
import { addCameraMove, layerToColor, nextStep } from './next-step'

const node = (id: string, op: string, params: EditorDoc['nodes'][0]['params'] = {}) => ({
  id,
  op,
  x: 0,
  y: 0,
  params,
})
const doc = (nodes: EditorDoc['nodes'], timeline?: EditorDoc['timeline']): EditorDoc => ({
  version: 1,
  name: 'p',
  nodes,
  edges: [],
  ...(timeline ? { timeline } : {}),
})
const DATA = node('rows', 'file', { url: '@/data.csv', format: 'csv' })
const DECK = node('deck', 'deck', { bearing: 10 })
const ANIMATED = {
  length: 4,
  fps: 30,
  tracks: [
    {
      target: 'deck.bearing',
      keyframes: [
        { id: 'a', time: 0, value: 0, interpolation: 'linear' as const },
        { id: 'b', time: 4, value: 90, interpolation: 'linear' as const },
      ],
    },
  ],
}

describe('nextStep', () => {
  it('walks a project from no data to exported, one step at a time', () => {
    expect(nextStep(doc([DECK]))?.id).toBe('load-data')
    const plain = node('dots', 'scatter', { position: '[lng, lat]' })
    expect(nextStep(doc([DATA, plain, DECK]))?.id).toBe('color-by-column')
    const colored = node('dots', 'scatter', { position: '[lng, lat]', color: 'ramp(v)' })
    expect(nextStep(doc([DATA, colored, DECK]))?.id).toBe('animate-camera')
    expect(nextStep(doc([DATA, colored, DECK], ANIMATED))?.id).toBe('export-video')
    expect(nextStep(doc([DATA, colored, DECK], ANIMATED), { exported: true })).toBeUndefined()
  })

  it('counts any color channel, and a timeline only with a move in it', () => {
    const arcs = node('arcs', 'arc', { source: '[a, b]', target: '[b, a]', sourceColor: 'c' })
    expect(nextStep(doc([DATA, arcs, DECK]))?.id).toBe('animate-camera')
    const oneKey = {
      ...ANIMATED,
      tracks: [{ ...ANIMATED.tracks[0], keyframes: [ANIMATED.tracks[0].keyframes[0]] }],
    }
    expect(nextStep(doc([DATA, arcs, DECK], oneKey))?.id).toBe('animate-camera')
  })

  it('goes past coloring when there is no layer to color', () => {
    expect(nextStep(doc([DATA, DECK]))?.id).toBe('animate-camera')
  })

  it('goes past coloring for layers that color by a range, not a column', () => {
    const heat = node('heat', 'heatmap', { position: '[lng, lat]' })
    expect(nextStep(doc([DATA, heat, DECK]))?.id).toBe('animate-camera')
    expect(layerToColor(doc([DATA, heat, node('dots', 'scatter')]))).toBe('dots')
  })
})

describe('the steps the bar takes', () => {
  it('picks the first layer to color', () => {
    expect(layerToColor(doc([DATA, node('a', 'scatter'), node('b', 'path')]))).toBe('a')
  })

  it('keyframes a quarter turn of the camera over the timeline', () => {
    const d = doc([DATA, DECK])
    expect(addCameraMove(d)).toEqual({ ok: true })
    const track = d.timeline?.tracks.find(t => t.target === 'deck.bearing')
    expect(track?.keyframes.map(k => [k.time, k.value])).toEqual([
      [0, 10],
      [d.timeline?.length ?? 0, 100],
    ])
    expect(addCameraMove(doc([DATA]))).toEqual({ ok: false, reason: 'No camera to move.' })
  })

  it('keys the View State wired into the deck, the camera the map shows', () => {
    const view = node('view', 'view-state', { bearing: 30 })
    const d = {
      ...doc([DATA, DECK, view]),
      edges: [
        { id: 'e', source: 'view', sourcePort: 'out', target: 'deck', targetPort: 'viewState' },
      ],
    }
    expect(addCameraMove(d)).toEqual({ ok: true })
    expect(d.timeline?.tracks.map(t => t.target)).toEqual(['view.bearing'])
    expect(d.timeline?.tracks[0].keyframes.map(k => k.value)).toEqual([30, 120])
  })

  it('keys nothing on a camera an expression drives, and says why', () => {
    const d = doc([DATA, node('deck', 'deck', { bearing: { expr: 'T * 10' } })])
    const result = addCameraMove(d)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.reason).toMatch(/Expressions or references drive .*bearing/)
    expect(d.timeline?.tracks ?? []).toEqual([])
  })
})
