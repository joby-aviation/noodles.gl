import type { Deck } from '@deck.gl/core'
import type { FrameCounter, FrameStats } from './frame-stats'

type ToolWindow = Window & {
  __deckCanvas?: HTMLCanvasElement
  __deckInstance?: Deck
  __deckStats?: FrameStats & { layerCount: number }
}

// Exposes the canvas, deck instance and frame stats to the AI tools (capture_visualization,
// inspect_layer, get_render_stats). Getters, because the deck is created after the editor
// mounts, and the stats should be current when read, not frozen at the last frame.
// Returns the cleanup.
export function exposeCanvasToTools(
  deckRef: { current: Deck | null },
  frames: FrameCounter
): () => void {
  const w = window as ToolWindow
  Object.defineProperties(w, {
    __deckCanvas: {
      configurable: true,
      // With a basemap, the interleaved deck is built on MapLibre's WebGL context, so its
      // canvas is the map canvas. Unlike the map ref, it is there before the map's load
      // event and never outlives a removed basemap.
      // @ts-expect-error canvas is protected but accessible
      get: () => deckRef.current?.canvas ?? undefined,
    },
    __deckInstance: { configurable: true, get: () => deckRef.current ?? undefined },
    __deckStats: {
      configurable: true,
      get: () => {
        const stats = frames.stats()
        if (!stats) return undefined
        // @ts-expect-error layerManager is protected but accessible
        const layerCount: number = deckRef.current?.layerManager?.getLayers().length ?? 0
        return { ...stats, layerCount }
      },
    },
  })
  return () => {
    delete w.__deckCanvas
    delete w.__deckInstance
    delete w.__deckStats
  }
}
