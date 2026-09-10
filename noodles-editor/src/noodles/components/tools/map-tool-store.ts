import { create } from 'zustand'

// Which interactive map tool is armed. The shelf sets this; the overlay in the output
// pane reads it and takes over clicks on the map. Only one tool is armed at a time so
// a click is never ambiguous.
export type MapTool = 'measure' | 'draw' | null

export type MeasureMode = 'distance' | 'area'
export type DrawMode = 'point' | 'line' | 'polygon'
export type DistanceUnit = 'kilometers' | 'miles' | 'meters' | 'nauticalmiles'

export interface MapToolStoreState {
  activeTool: MapTool
  measureMode: MeasureMode
  distanceUnit: DistanceUnit
  drawMode: DrawMode
  // Set when Draw was started from the shelf and needs a GeoEditor node to write into.
  // The overlay scaffolds one on first use and remembers it for the session.
  drawTargetOpId: string | null
  setActiveTool: (tool: MapTool) => void
  // Arming the same tool twice disarms it, so the shelf button behaves like a toggle
  toggleTool: (tool: Exclude<MapTool, null>) => void
  setMeasureMode: (mode: MeasureMode) => void
  setDistanceUnit: (unit: DistanceUnit) => void
  setDrawMode: (mode: DrawMode) => void
  setDrawTargetOpId: (id: string | null) => void
}

export const useMapToolStore = create<MapToolStoreState>(set => ({
  activeTool: null,
  measureMode: 'distance',
  distanceUnit: 'kilometers',
  drawMode: 'polygon',
  drawTargetOpId: null,
  setActiveTool: tool => set({ activeTool: tool }),
  toggleTool: tool => set(state => ({ activeTool: state.activeTool === tool ? null : tool })),
  setMeasureMode: mode => set({ measureMode: mode }),
  setDistanceUnit: unit => set({ distanceUnit: unit }),
  setDrawMode: mode => set({ drawMode: mode }),
  setDrawTargetOpId: id => set({ drawTargetOpId: id }),
}))
