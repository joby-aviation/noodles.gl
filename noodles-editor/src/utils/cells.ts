// Grid cells as polygons: the ring a cell id outlines, closed and [lng, lat], for H3, S2, A5,
// geohash and quadkey ids, as deck's cell layers draw them. The engine makes polygon rows of
// them, so cells draw as any polygon does.

import { cellToBoundary as a5Boundary, hexToU64 } from 'a5-js'
import { getS2Polygon } from 'deck-s2-utils'
import { cellsToMultiPolygon, cellToBoundary } from 'h3-js'

export type CellKind = 'h3' | 's2' | 'a5' | 'geohash' | 'quadkey'

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz'

// A geohash's box: each character halves longitude and latitude alternately, five bits at a time
function geohashBounds(hash: string): [number, number, number, number] {
  let even = true
  const lng = [-180, 180]
  const lat = [-90, 90]
  for (const c of hash.toLowerCase()) {
    const bits = BASE32.indexOf(c)
    if (bits < 0) throw new Error(`'${hash}' is not a geohash`)
    for (let b = 4; b >= 0; b--) {
      const range = even ? lng : lat
      const mid = (range[0] + range[1]) / 2
      if ((bits >> b) & 1) range[0] = mid
      else range[1] = mid
      even = !even
    }
  }
  return [lng[0], lat[0], lng[1], lat[1]]
}

// A quadkey's web-mercator tile as a box
function quadkeyBounds(key: string): [number, number, number, number] {
  let x = 0
  let y = 0
  for (const c of key) {
    const d = Number(c)
    if (!(d >= 0 && d <= 3)) throw new Error(`'${key}' is not a quadkey`)
    x = x * 2 + (d & 1)
    y = y * 2 + (d >> 1)
  }
  const n = 2 ** key.length
  const lng = (t: number) => (t / n) * 360 - 180
  const lat = (t: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * t) / n))) * 180) / Math.PI
  return [lng(x), lat(y + 1), lng(x + 1), lat(y)]
}

const box = ([w, s, e, n]: number[]): number[][] => [
  [w, s],
  [e, s],
  [e, n],
  [w, n],
  [w, s],
]

/** The closed [lng, lat] ring of one cell. */
export function cellRing(kind: CellKind, id: string | number | bigint): number[][] {
  switch (kind) {
    case 'h3':
      return cellToBoundary(String(id), true)
    case 'a5':
      return a5Boundary(typeof id === 'bigint' ? id : hexToU64(String(id)), {
        closedRing: true,
        segments: 'auto',
      })
    case 's2': {
      const flat = getS2Polygon(String(id))
      const ring: number[][] = []
      for (let i = 0; i < flat.length; i += 2) ring.push([flat[i], flat[i + 1]])
      return ring
    }
    case 'geohash':
      return box(geohashBounds(String(id)))
    case 'quadkey':
      return box(quadkeyBounds(String(id)))
  }
}

/** The outline of a set of H3 cells, merged: GeoJSON MultiPolygon coordinates. */
export function h3Cluster(ids: string[]): number[][][][] {
  return cellsToMultiPolygon(ids, true)
}
