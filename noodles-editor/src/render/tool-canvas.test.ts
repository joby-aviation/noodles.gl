import type { Deck } from '@deck.gl/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FrameCounter } from './frame-stats'
import { exposeCanvasToTools } from './tool-canvas'

type ToolWindow = Window & {
  __deckCanvas?: HTMLCanvasElement
  __deckInstance?: Deck
  __deckStats?: { fps: number; lastFrameTime: number; layerCount: number; timestamp: number }
}
const w = window as ToolWindow

let cleanup: (() => void) | undefined
afterEach(() => cleanup?.())

const deckWithCanvas = (canvas: HTMLCanvasElement | null) => ({ canvas }) as unknown as Deck

describe('exposeCanvasToTools', () => {
  it('finds the deck and its canvas once deck exists, after the globals are installed', () => {
    const deckRef: { current: Deck | null } = { current: null }
    cleanup = exposeCanvasToTools(deckRef, new FrameCounter())
    expect(w.__deckCanvas).toBeUndefined()
    expect(w.__deckInstance).toBeUndefined()

    // With a basemap this is MapLibreOverlay's deck, whose canvas is the map canvas
    const canvas = document.createElement('canvas')
    deckRef.current = deckWithCanvas(canvas)

    expect(w.__deckCanvas).toBe(canvas)
    expect(w.__deckInstance).toBe(deckRef.current)
  })

  it('has no canvas while the deck has not attached to one yet', () => {
    cleanup = exposeCanvasToTools({ current: deckWithCanvas(null) }, new FrameCounter())
    expect(w.__deckCanvas).toBeUndefined()
  })

  it('follows a new deck when the basemap is removed and added back', () => {
    const first = document.createElement('canvas')
    const deckRef: { current: Deck | null } = { current: deckWithCanvas(first) }
    cleanup = exposeCanvasToTools(deckRef, new FrameCounter())
    expect(w.__deckCanvas).toBe(first)

    const second = document.createElement('canvas')
    deckRef.current = deckWithCanvas(second)
    expect(w.__deckCanvas).toBe(second)
  })

  it('removes the globals on cleanup', () => {
    const canvas = document.createElement('canvas')
    exposeCanvasToTools({ current: deckWithCanvas(canvas) }, new FrameCounter())()
    cleanup = undefined

    expect('__deckCanvas' in w).toBe(false)
    expect('__deckInstance' in w).toBe(false)
    expect('__deckStats' in w).toBe(false)
  })

  it('reports frame stats as of the moment they are read', async () => {
    const frames = new FrameCounter()
    const layers = [{ id: 'a' }, { id: 'b' }]
    const deck = { canvas: null, layerManager: { getLayers: () => layers } } as unknown as Deck
    cleanup = exposeCanvasToTools({ current: deck }, frames)
    expect(w.__deckStats).toBeUndefined()

    const now = Date.now()
    for (let i = 0; i < 30; i++) {
      frames.frame(now - 1000 + 20 + i * 30)
      await Promise.resolve()
    }
    expect(w.__deckStats).toEqual({
      fps: 30,
      lastFrameTime: 30,
      layerCount: 2,
      timestamp: now - 110,
    })

    // Nothing drawn since: the same getter now reads 0
    vi.setSystemTime(now + 2000)
    expect(w.__deckStats?.fps).toBe(0)
  })
})
