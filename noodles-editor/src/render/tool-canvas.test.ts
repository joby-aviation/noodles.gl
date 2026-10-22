import type { Deck } from '@deck.gl/core'
import { afterEach, describe, expect, it } from 'vitest'
import { exposeCanvasToTools } from './tool-canvas'

type ToolWindow = Window & { __deckCanvas?: HTMLCanvasElement; __deckInstance?: Deck }
const w = window as ToolWindow

let cleanup: (() => void) | undefined
afterEach(() => cleanup?.())

const deckWithCanvas = (canvas: HTMLCanvasElement | null) => ({ canvas }) as unknown as Deck

describe('exposeCanvasToTools', () => {
  it('finds the deck and its canvas once deck exists, after the globals are installed', () => {
    const deckRef: { current: Deck | null } = { current: null }
    cleanup = exposeCanvasToTools(deckRef)
    expect(w.__deckCanvas).toBeUndefined()
    expect(w.__deckInstance).toBeUndefined()

    // With a basemap this is MapLibreOverlay's deck, whose canvas is the map canvas
    const canvas = document.createElement('canvas')
    deckRef.current = deckWithCanvas(canvas)

    expect(w.__deckCanvas).toBe(canvas)
    expect(w.__deckInstance).toBe(deckRef.current)
  })

  it('has no canvas while the deck has not attached to one yet', () => {
    cleanup = exposeCanvasToTools({ current: deckWithCanvas(null) })
    expect(w.__deckCanvas).toBeUndefined()
  })

  it('follows a new deck when the basemap is removed and added back', () => {
    const first = document.createElement('canvas')
    const deckRef: { current: Deck | null } = { current: deckWithCanvas(first) }
    cleanup = exposeCanvasToTools(deckRef)
    expect(w.__deckCanvas).toBe(first)

    const second = document.createElement('canvas')
    deckRef.current = deckWithCanvas(second)
    expect(w.__deckCanvas).toBe(second)
  })

  it('removes the globals on cleanup', () => {
    const canvas = document.createElement('canvas')
    exposeCanvasToTools({ current: deckWithCanvas(canvas) })()
    cleanup = undefined

    expect('__deckCanvas' in w).toBe(false)
    expect('__deckInstance' in w).toBe(false)
  })
})
