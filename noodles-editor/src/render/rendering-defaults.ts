import type { DeckProps } from '@deck.gl/core'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import type { MapProps } from 'react-map-gl/maplibre'

export const deckRenderingDefaults: DeckProps = {
  deviceProps: {
    type: 'webgl',
    powerPreference: 'high-performance',
    webgl: {
      stencil: true,
    },
  },
  useDevicePixels: false,
}

export const mapRenderingDefaults: MapProps = {
  workerUrl: maplibreWorkerUrl,
  interactive: false,
  canvasContextAttributes: {
    antialias: true,
    preserveDrawingBuffer: true,
  },
}
