// Maps a feature picked on the map back to the operator that drew it, for click-to-edit.
//
// Layer operators set the deck.gl layer `id` to their own path (`/scatter`, or
// `/group/scatter` inside a container). Composite layers (GeoJsonLayer, TripsLayer, ...)
// draw through sublayers whose ids add a suffix (`/scatter-points-circle`), and deck
// reports both the top-level layer (`info.layer`) and the one that drew the pixel
// (`info.sourceLayer`), each with a `parent` chain.

export type PickedLayer = { id: string; parent?: PickedLayer | null }

export type PickedInfo = {
  layer?: PickedLayer | null
  sourceLayer?: PickedLayer | null
}

type LayerOperatorLookup = (id: string) => boolean

// Layer ids from the outermost layer in to the one that drew the pixel, without repeats
function layerChain(info: PickedInfo): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  for (const start of [info.sourceLayer, info.layer]) {
    let layer = start
    while (layer) {
      if (!seen.has(layer.id)) {
        seen.add(layer.id)
        ids.push(layer.id)
      }
      layer = layer.parent
    }
  }
  // The walk went inner to outer; the outermost layer is the one an operator returned
  return ids.reverse()
}

// Returns the id of the layer operator whose layer drew the picked feature, or null when
// the pick is empty or no layer operator has that exact id (a code-built layer with its
// own id, an id replaced through LayerProps, the editor's selection overlay). Ids are never
// guessed from prefixes: a layer named `/custom-copy` is not `/custom`'s. `isLayerOperator`
// must reject non-layer operators, so a data node that shares an id is never selected.
export function findPickedOperatorId(
  info: PickedInfo | null | undefined,
  isLayerOperator: LayerOperatorLookup
): string | null {
  if (!info) return null
  for (const id of layerChain(info)) {
    if (isLayerOperator(id)) return id
  }
  return null
}

export type ScreenPoint = { x: number; y: number }

// How far, in CSS pixels, the pointer may move between press and release and still be a
// click. Matches MapLibre's default clickTolerance plus a pixel; a drag that moves the
// map moves it further than this.
export const CLICK_TOLERANCE_PX = 4

// A press and release close together is a click; anything further moved the camera or
// dragged something. With no press on record (a synthetic click), there was no drag.
export function isClickNotDrag(
  down: ScreenPoint | null,
  up: ScreenPoint | null,
  tolerance = CLICK_TOLERANCE_PX
): boolean {
  if (!down || !up) return true
  return Math.hypot(up.x - down.x, up.y - down.y) <= tolerance
}

type Size = { width: number; height: number }

// Puts a label below and right of the pointer, flipping to the other side of an axis
// where it would run past the edge of the map
export function placeLabel(
  pointer: ScreenPoint,
  label: Size,
  bounds: Size,
  offset: number
): ScreenPoint {
  const axis = (at: number, size: number, limit: number) =>
    at + offset + size <= limit ? at + offset : Math.max(0, at - offset - size)
  return {
    x: axis(pointer.x, label.width, bounds.width),
    y: axis(pointer.y, label.height, bounds.height),
  }
}
