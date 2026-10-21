import type { Deck } from '@deck.gl/core'
import { describe, expect, it } from 'vitest'
import { pickVisualizationCanvas } from './visualization-target'

// The editor's choice of canvas for capture_visualization, given its map and deck refs
describe('pickVisualizationCanvas', () => {
  const mapCanvas = document.createElement('canvas')
  const deckCanvas = document.createElement('canvas')
  const map = { getCanvas: () => mapCanvas }
  const deck = { canvas: deckCanvas } as unknown as Deck

  it('captures the map canvas with a basemap, so the screenshot includes it', () => {
    expect(pickVisualizationCanvas({ basemapEnabled: true, map, deck })).toBe(mapCanvas)
  })

  it("falls back to the deck canvas before the map's load event sets the map ref", () => {
    expect(pickVisualizationCanvas({ basemapEnabled: true, map: null, deck })).toBe(deckCanvas)
  })

  it('captures the deck canvas without a basemap', () => {
    expect(pickVisualizationCanvas({ basemapEnabled: false, map, deck })).toBe(deckCanvas)
  })

  it('returns null while neither the map nor the deck exists', () => {
    expect(pickVisualizationCanvas({ basemapEnabled: true, map: null, deck: null })).toBeNull()
  })
})
