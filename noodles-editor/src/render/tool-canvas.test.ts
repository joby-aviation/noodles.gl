import type { Deck } from '@deck.gl/core'
import type { Map as MapLibre } from 'maplibre-gl'
import { afterEach, describe, expect, it } from 'vitest'
import { exposeCanvasToTools } from './tool-canvas'

type ToolWindow = Window & { __deckCanvas?: HTMLCanvasElement; __deckInstance?: Deck }
const w = window as ToolWindow

let cleanup: (() => void) | undefined
afterEach(() => cleanup?.())

describe('exposeCanvasToTools', () => {
  it('finds the map canvas once the map exists, after the globals are installed', () => {
    const mapRef: { current: MapLibre | null } = { current: null }
    const deckRef: { current: Deck | null } = { current: null }
    cleanup = exposeCanvasToTools(true, mapRef, deckRef)
    expect(w.__deckCanvas).toBeUndefined()

    const canvas = document.createElement('canvas')
    mapRef.current = { getCanvas: () => canvas } as unknown as MapLibre
    const deck = { canvas: document.createElement('canvas') } as unknown as Deck
    deckRef.current = deck

    // Interleaved: deck draws into MapLibre's canvas, so that is the one to capture
    expect(w.__deckCanvas).toBe(canvas)
    expect(w.__deckInstance).toBe(deck)
  })

  it('finds the deck canvas once deck exists when there is no basemap', () => {
    const deckRef: { current: Deck | null } = { current: null }
    cleanup = exposeCanvasToTools(false, { current: null }, deckRef)
    expect(w.__deckCanvas).toBeUndefined()

    const canvas = document.createElement('canvas')
    deckRef.current = { canvas } as unknown as Deck

    expect(w.__deckCanvas).toBe(canvas)
  })

  it('removes the globals on cleanup', () => {
    const canvas = document.createElement('canvas')
    exposeCanvasToTools(false, { current: null }, { current: { canvas } as unknown as Deck })()
    cleanup = undefined

    expect('__deckCanvas' in w).toBe(false)
    expect('__deckInstance' in w).toBe(false)
  })
})
