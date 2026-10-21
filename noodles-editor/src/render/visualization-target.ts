// Glue between the AI tools that look at the visualization (capture_visualization,
// inspect_layer) and the editor. The deck instance and canvas are not ready at mount:
// with a basemap, MapLibreOverlay only creates its deck once the map has loaded. So the
// editor registers getters that read its refs when a tool asks, not a snapshot taken once.
// Kept free of React and of the ai-chat modules, like video-export.ts.

import type { Deck } from '@deck.gl/core'

export interface VisualizationTarget {
  getCanvas: () => HTMLCanvasElement | null | undefined
  getDeck: () => Deck | null | undefined
}

let target: VisualizationTarget | null = null

export function setVisualizationTarget(next: VisualizationTarget | null) {
  target = next
}

// The canvas that holds the whole frame. With a basemap, deck draws into the map's canvas,
// so capturing it gets both. The map is only known once it loads; until then the
// interleaved deck's canvas is that same map canvas.
export function pickVisualizationCanvas({
  basemapEnabled,
  map,
  deck,
}: {
  basemapEnabled: boolean
  map: { getCanvas: () => HTMLCanvasElement } | null | undefined
  deck: Deck | null | undefined
}): HTMLCanvasElement | null {
  if (basemapEnabled && map) return map.getCanvas()
  // @ts-expect-error canvas is protected but accessible
  return deck?.canvas ?? null
}

export function getVisualizationCanvas(): HTMLCanvasElement | null {
  return target?.getCanvas() ?? null
}

export function getVisualizationDeck(): Deck | null {
  return target?.getDeck() ?? null
}
