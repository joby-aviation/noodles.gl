// Glue between the AI tools that look at the visualization (capture_visualization,
// inspect_layer) and the editor. The deck instance is not ready at mount: with a basemap,
// MapLibreOverlay only creates its deck once the map exists. So the editor registers a
// getter that reads its ref when a tool asks, not a snapshot taken once.
// Kept free of React and of the ai-chat modules, like video-export.ts.

import type { Deck } from '@deck.gl/core'

export interface VisualizationTarget {
  getDeck: () => Deck | null | undefined
}

let target: VisualizationTarget | null = null

export function setVisualizationTarget(next: VisualizationTarget | null) {
  target = next
}

export function getVisualizationDeck(): Deck | null {
  return target?.getDeck() ?? null
}

// The canvas that holds the whole frame. With a basemap, the interleaved deck is built on
// the map's WebGL context, so its canvas is the map canvas and a capture includes both.
export function getVisualizationCanvas(): HTMLCanvasElement | null {
  // @ts-expect-error canvas is protected but accessible
  return getVisualizationDeck()?.canvas ?? null
}
