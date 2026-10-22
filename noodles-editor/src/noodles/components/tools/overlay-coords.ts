// Coordinate conversion between an absolutely-positioned overlay and the maplibre
// canvas underneath it. These are separate boxes: the map sits inside a wrapper that
// CSS-scales in fixed display mode, and its canvas can be sized at a different
// resolution than it is displayed at. Getting this wrong puts clicks in the wrong
// place, subtly at scale 1 and badly in split view, so the maths is pure and tested.

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

// A client-space pointer position expressed in the map's own CSS pixel space, which
// is what map.unproject expects.
export function clientToMapPoint(
  client: Point,
  // Canvas position and displayed size, from getBoundingClientRect
  canvasRect: Box,
  // Canvas size in CSS pixels, from clientWidth/clientHeight
  canvasSize: { width: number; height: number }
): Point | null {
  if (canvasRect.width === 0 || canvasRect.height === 0) return null
  return {
    x: ((client.x - canvasRect.left) * canvasSize.width) / canvasRect.width,
    y: ((client.y - canvasRect.top) * canvasSize.height) / canvasRect.height,
  }
}

// A point from map.project expressed in the overlay's own layout space, which is
// what its absolutely-positioned SVG children are drawn in. The ratio between the
// overlay's visual rect and its layout size absorbs any ancestor CSS scale.
export function mapPointToOverlay(
  mapPoint: Point,
  canvasRect: Box,
  canvasSize: { width: number; height: number },
  overlayRect: Box,
  overlaySize: { width: number; height: number }
): Point | null {
  if (canvasSize.width === 0 || canvasSize.height === 0) return null
  if (overlayRect.width === 0 || overlayRect.height === 0) return null
  const clientX = canvasRect.left + (mapPoint.x * canvasRect.width) / canvasSize.width
  const clientY = canvasRect.top + (mapPoint.y * canvasRect.height) / canvasSize.height
  return {
    x: ((clientX - overlayRect.left) * overlaySize.width) / overlayRect.width,
    y: ((clientY - overlayRect.top) * overlaySize.height) / overlayRect.height,
  }
}
