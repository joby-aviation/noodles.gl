import { create } from 'zustand'
import type { EditTarget } from './edit-target'
import type { SourceRef } from './geo-recipes'

// Which interactive map tool is armed. The shelf sets this; the overlay in the output
// pane reads it and takes over clicks on the map. Only one tool is armed at a time so
// a click is never ambiguous.
export type MapTool = 'measure' | 'draw' | null

export type MeasureMode = 'distance' | 'area'
export type DrawMode = 'point' | 'line' | 'polygon'
export type DistanceUnit = 'kilometers' | 'miles' | 'meters' | 'nauticalmiles'

// Asks the shelf to open a geo recipe wizard with some inputs already wired. The Draw
// tool uses this to hand a finished drawing to Clip, Buffer and the like.
export interface RecipeRequest {
  recipeId: string
  sources: Record<string, SourceRef>
}

export interface MapToolStoreState {
  activeTool: MapTool
  measureMode: MeasureMode
  distanceUnit: DistanceUnit
  drawMode: DrawMode
  // Set while Draw is editing an existing GeoEditor or Point node instead of making new
  // shapes. Cleared whenever the tool is disarmed or switched.
  editTarget: EditTarget | null
  // Whether a map the tools can draw on is mounted. False with a blank map style (no
  // basemap to project through) and during a video export.
  mapReady: boolean
  recipeRequest: RecipeRequest | null
  setActiveTool: (tool: MapTool) => void
  // Arming the same tool twice disarms it, so the shelf button behaves like a toggle
  toggleTool: (tool: Exclude<MapTool, null>) => void
  setMeasureMode: (mode: MeasureMode) => void
  setDistanceUnit: (unit: DistanceUnit) => void
  setDrawMode: (mode: DrawMode) => void
  // Arms Draw on an existing node's geometry
  startEditing: (target: EditTarget) => void
  requestRecipe: (request: RecipeRequest | null) => void
  setMapReady: (ready: boolean) => void
}

export const useMapToolStore = create<MapToolStoreState>(set => ({
  activeTool: null,
  measureMode: 'distance',
  distanceUnit: 'kilometers',
  drawMode: 'polygon',
  editTarget: null,
  mapReady: false,
  recipeRequest: null,
  setActiveTool: tool => set({ activeTool: tool, editTarget: null }),
  toggleTool: tool =>
    set(state => ({ activeTool: state.activeTool === tool ? null : tool, editTarget: null })),
  setMeasureMode: mode => set({ measureMode: mode }),
  setDistanceUnit: unit => set({ distanceUnit: unit }),
  setDrawMode: mode => set({ drawMode: mode }),
  startEditing: target =>
    set({
      activeTool: 'draw',
      editTarget: target,
      drawMode: target.kind === 'point' ? 'point' : 'polygon',
    }),
  requestRecipe: request => set({ recipeRequest: request }),
  setMapReady: ready => set({ mapReady: ready }),
}))
