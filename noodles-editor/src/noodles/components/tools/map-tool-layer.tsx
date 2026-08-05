import type { Map as MapLibre } from 'maplibre-gl'
import { type RefObject, useEffect } from 'react'
import { useMapToolGraph } from '../../hooks/use-map-tool-graph'
import { MapToolOverlay } from './map-tool-overlay'
import { useMapToolStore } from './map-tool-store'

interface MapToolLayerProps {
  mapRef: RefObject<MapLibre | null>
  // Map tools project through the basemap camera, so they need a basemap to exist
  basemapEnabled: boolean
  // Tools stay out of the way of a video export
  isRendering: boolean
}

// Bridges the armed map tool to the graph. Kept separate from the overlay so the
// overlay stays a presentational component with injectable callbacks.
export function MapToolLayer({ mapRef, basemapEnabled, isRendering }: MapToolLayerProps) {
  const activeTool = useMapToolStore(state => state.activeTool)
  const setActiveTool = useMapToolStore(state => state.setActiveTool)
  const { saveDrawing, saveMeasurement } = useMapToolGraph()

  // Disarm rather than silently ignore clicks when the tool cannot work here,
  // so the shelf button never stays lit with nothing happening.
  useEffect(() => {
    if (activeTool && (!basemapEnabled || isRendering)) setActiveTool(null)
  }, [activeTool, basemapEnabled, isRendering, setActiveTool])

  if (!basemapEnabled || isRendering) return null

  return (
    <MapToolOverlay
      mapRef={mapRef}
      onSaveDrawing={saveDrawing}
      onSaveMeasurement={saveMeasurement}
    />
  )
}
