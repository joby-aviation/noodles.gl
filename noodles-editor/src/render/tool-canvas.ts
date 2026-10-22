import type { Deck } from '@deck.gl/core'

type ToolWindow = Window & { __deckCanvas?: HTMLCanvasElement; __deckInstance?: Deck }

// Exposes the canvas and deck instance to the AI tools (capture_visualization,
// inspect_layer). Getters, because the deck is created after the editor mounts: a value
// read at mount would stay undefined. Returns the cleanup.
export function exposeCanvasToTools(deckRef: { current: Deck | null }): () => void {
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
  })
  return () => {
    delete w.__deckCanvas
    delete w.__deckInstance
  }
}
