import type { Deck } from '@deck.gl/core'
import { afterEach, describe, expect, it } from 'vitest'
import {
  getVisualizationCanvas,
  getVisualizationDeck,
  setVisualizationTarget,
} from './visualization-target'

// With a basemap the deck is MapLibreOverlay's, built on the map's WebGL context, so its
// canvas is the map canvas. Reading it through the deck means a removed and re-added
// basemap never leaves a stale map behind.
describe('visualization target', () => {
  afterEach(() => setVisualizationTarget(null))

  it('has no deck or canvas while the editor is not mounted', () => {
    expect(getVisualizationDeck()).toBeNull()
    expect(getVisualizationCanvas()).toBeNull()
  })

  it("reads the deck's canvas when asked, not when registered", () => {
    let deck: Deck | null = null
    setVisualizationTarget({ getDeck: () => deck })
    expect(getVisualizationCanvas()).toBeNull()

    const first = document.createElement('canvas')
    deck = { canvas: first } as unknown as Deck
    expect(getVisualizationDeck()).toBe(deck)
    expect(getVisualizationCanvas()).toBe(first)

    // The basemap was removed and added back: a new overlay deck on a new map canvas
    const second = document.createElement('canvas')
    deck = { canvas: second } as unknown as Deck
    expect(getVisualizationCanvas()).toBe(second)
  })

  it('returns null while the deck has no canvas yet', () => {
    setVisualizationTarget({ getDeck: () => ({ canvas: null }) as unknown as Deck })
    expect(getVisualizationCanvas()).toBeNull()
  })
})
