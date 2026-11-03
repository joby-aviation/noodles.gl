/**
 * Triangle indices for polygon layers, computed by the caller rather than the renderer.
 *
 * CesiumJS's `BufferPolygonCollection` takes the same position: the collection stores offset
 * and count into one vertex array, hole starts, and a triangle index range, and the caller
 * supplies the triangulation (with earcut). deck's `SolidPolygonLayer` accepts that too: given
 * binary `startIndices`, `attributes.indices` and `_normalize: false`, it skips its own
 * tessellation. Doing it here means it happens once per evaluation, is timed, and is reported,
 * instead of being an invisible cost inside deck's attribute update.
 *
 * earcut runs in the positions' own coordinates, lng/lat for a map layer. deck projects to
 * mercator first when it tessellates; for polygons small next to the earth's curvature the
 * difference is invisible, and that is the case this is built for.
 */

import { earcut } from '@math.gl/polygon'

export interface Triangulation {
  /** Indices into the layer's vertex rows, three per triangle. */
  indices: Uint32Array
  /** Polygons skipped because a vertex was NaN (a null position). */
  skipped: number
  ms: number
}

/**
 * `starts` are the first row of each polygon and `rings` the first row of each ring, both in
 * row order and both from the same run-length pass (`runStarts`, `ringStarts`). A ring start
 * inside a polygon, after its first, is a hole.
 */
export function triangulate(
  positions: Float32Array,
  width: number,
  rows: number,
  starts: Uint32Array,
  rings: Uint32Array
): Triangulation {
  const started = performance.now()
  const out: number[] = []
  let skipped = 0
  let r = 0
  for (let p = 0; p < starts.length; p++) {
    const s = starts[p]
    const e = p + 1 < starts.length ? starts[p + 1] : rows
    const holes: number[] = []
    while (r < rings.length && rings[r] < e) {
      if (rings[r] > s) holes.push(rings[r] - s)
      r++
    }
    const coords = positions.subarray(s * width, e * width)
    if (coords.some(Number.isNaN)) {
      skipped++
      continue
    }
    // earcut reads x and y and ignores the rest of each `width`-wide vertex.
    const local = earcut(coords, holes.length ? holes : undefined, width)
    for (const i of local) out.push(i + s)
  }
  return { indices: Uint32Array.from(out), skipped, ms: performance.now() - started }
}
