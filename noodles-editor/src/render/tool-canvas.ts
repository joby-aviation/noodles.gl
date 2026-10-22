import type { Deck } from '@deck.gl/core'
import type { Map as MapLibre } from 'maplibre-gl'

type ToolWindow = Window & { __deckCanvas?: HTMLCanvasElement; __deckInstance?: Deck }

// Exposes the canvas and deck instance to the AI tools (capture_visualization,
// inspect_layer). Getters, because the map and deck are created after the editor
// mounts: a value read at mount would stay undefined. Returns the cleanup.
export function exposeCanvasToTools(
  basemapEnabled: boolean,
  mapRef: { current: MapLibre | null },
  deckRef: { current: Deck | null }
): () => void {
  const w = window as ToolWindow
  Object.defineProperties(w, {
    __deckCanvas: {
      configurable: true,
      // With a basemap, deck draws into MapLibre's canvas (interleaved), so capture that one
      get: () =>
        basemapEnabled
          ? mapRef.current?.getCanvas()
          : // @ts-expect-error canvas is protected but accessible
            deckRef.current?.canvas,
    },
    __deckInstance: { configurable: true, get: () => deckRef.current ?? undefined },
  })
  return () => {
    delete w.__deckCanvas
    delete w.__deckInstance
  }
}
