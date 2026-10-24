// What code run in the engine can use besides its arguments: the libraries CodeOp has always
// had that need no page (no deck, no DOM). Shared by JS tables and JS functions.

import * as turf from '@turf/turf'
import * as d3 from 'd3'
import { choroplethJoin } from '../../noodles/utils/choropleth-boundaries'
import * as arc from '../../utils/arc-geometry'
import binarySearchClosest from '../../utils/binary-search-closest'
import * as cells from '../../utils/cells'
import * as color from '../../utils/color'
import * as cross from '../../utils/cross'
import * as distance from '../../utils/distance'
import * as lineInterpolation from '../../utils/geojson-line-interpolation'
import * as interpolate from '../../utils/interpolate'
import * as kml from '../../utils/kml-to-geojson'
import * as mapStyles from '../../utils/map-styles'
import * as osm from '../../utils/osm-to-geojson'
import * as random from '../../utils/random'
import * as wkt from '../../utils/wkt'

// `utils` as CodeOp has it, less directions, which needs the page (Google Maps, API keys)
const utils = {
  ...arc,
  ...cells,
  ...color,
  ...cross,
  ...distance,
  ...lineInterpolation,
  ...interpolate,
  ...kml,
  ...mapStyles,
  ...osm,
  ...random,
  ...wkt,
  binarySearchClosest,
  choroplethJoin,
}

export const JS_SCOPE: Record<string, unknown> = { utils, d3, turf }

// An async function's constructor, for code that awaits (a fetch); `new Function` makes only
// plain ones
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as FunctionConstructor

/**
 * A function from a body, with the scope's names bound after the parameters. An async one may
 * `await`; a JS function DuckDB calls per row must not be.
 */
export function compileWithScope(
  params: string[],
  body: string,
  { async = false } = {}
): (...args: unknown[]) => unknown {
  const names = Object.keys(JS_SCOPE)
  const values = Object.values(JS_SCOPE)
  const Make = async ? AsyncFunction : Function
  const fn = new Make(...params, ...names, body) as (...args: unknown[]) => unknown
  return (...args) => fn(...args, ...values)
}
