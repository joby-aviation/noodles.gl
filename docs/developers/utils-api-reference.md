# Utils API Reference

The `utils` object is in scope in `code` nodes and in `js-function` bodies, beside `d3` and `turf`. Both run in the engine worker, not the page, so `utils` holds the helpers that need no page: arcs, colors, cells, interpolation, parsing and constants. The scope is defined in `noodles-editor/src/runtime/worker/js-scope.ts`.

Routing directions call an API with the user's key from the page, so they are not in the worker's `utils`; use the **Directions** node instead.

## Arc Geometry

Functions for generating 3D arc paths between geographic points, adapted from deck.gl's arc layer.

### `getArc(options)`

Generate a 3D arc path between two points with configurable height and smoothing.

**Parameters:**
- `source: Point` - Starting point with `{ lat, lng, alt }` coordinates
- `target: Point` - Ending point with `{ lat, lng, alt }` coordinates
- `arcHeight: number` - Height of the arc peak in meters
- `smoothHeight?: boolean` - Smooth altitude transitions using Hermite interpolation (default: `true`)
- `smoothPosition?: boolean` - Smooth position transitions (default: `false`)
- `segmentCount?: number` - Number of segments in the arc (default: `250`)
- `wrapLongitude?: boolean` - Handle anti-meridian crossing for shortest path (default: `true`)
- `tilt?: number` - Tilt angle in degrees, -90 to 90 (default: `0`)

**Returns:** `number[][]` - Array of `[lng, lat, alt]` coordinates

**Example:**
```javascript
const arc = utils.getArc({
  source: { lat: 40.7128, lng: -74.0060, alt: 0 },    // NYC
  target: { lat: 51.5074, lng: -0.1278, alt: 0 },     // London
  arcHeight: 500000,  // 500km peak height
  tilt: 15,           // 15-degree tilt
  segmentCount: 100
})
```

### `mix(from, to, t)`

Linear interpolation between two numbers: `utils.mix(0, 100, 0.5)` returns `50`.

### `mixspace(start, end, mixAmount)`

`mix` across an array of ratios. Returns `number[]`.

### `clamp(x, lower, upper)`

Constrain a value within a range: `utils.clamp(150, 0, 100)` returns `100`.

### `range(stop)`

Integers from 0 to stop - 1: `utils.range(5)` returns `[0, 1, 2, 3, 4]`.

### `smoothstep(edge0, edge1, x)`

Smooth interpolation using a Hermite polynomial (S-curve). Returns a value from 0 to 1.

### `segmentRatios(segmentCount?, smooth?)`

Interpolation ratios from 0 to 1 for arc segments (defaults: `100`, `true`, which applies smoothstep).

### `paraboloid(distance, sourceZ, targetZ, ratio, scaleHeight?)`

Parabolic arc height at a ratio from 0 to 1 along the arc (`scaleHeight` defaults to `1.0`).

### `tiltPoint(point, start, end, tilt)`

Tilt a `[lng, lat, alt]` point along the arc from `start` to `end` by `tilt` degrees.

## Color Utilities

Functions for converting between color formats used in deck.gl and the timeline. A `Color` is deck.gl's `[r, g, b, a]` from 0 to 255; an RGBA object has `r`, `g`, `b`, `a` from 0 to 1.

| Function | Converts |
|----------|----------|
| `colorToRgba(color)` | `Color` to an RGBA object |
| `rgbaToColor(rgba, { alpha }?)` | RGBA object to a `Color`; `alpha: false` drops the fourth value |
| `rgbaToClearColor(rgba)` | RGBA object to a WebGL clear color, `[r, g, b, a]` from 0 to 1 |
| `hexToColor(hex)` | `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` to a `Color` (alpha 255 when absent) |
| `colorToHex(color)` | `Color` to a hex string, with alpha when the color has four values |
| `hexToRgba(hex)` | Hex string to an RGBA object |
| `rgbaToHex(rgba)` | RGBA object to `#rrggbbaa` |

**Example:**
```javascript
utils.hexToColor('#ff5733')          // [255, 87, 51, 255]
utils.hexToColor('#f57')             // [255, 85, 119, 255]
utils.colorToHex([255, 87, 51, 255]) // "#ff5733ff"
utils.colorToHex([255, 87, 51])      // "#ff5733"
```

A color a layer reads per row is `[r, g, b]` from 0 to 1, so divide a `Color` by 255 before returning it as a column.

## Array Utilities

### `cross(arr)`

All unique pairs from an array (combinations without repetition).

```javascript
utils.cross(['NYC', 'LA', 'CHI'])
// [['NYC', 'LA'], ['NYC', 'CHI'], ['LA', 'CHI']]
```

## Geospatial Utilities

### `parseWkt(wkt)`

Parse a Well-Known Text geometry into a GeoJSON geometry. Supports every OGC simple feature type, Z, M and ZM coordinates (M values are dropped) and an EWKT `SRID=4326;` prefix. Returns `null` for `EMPTY` geometries and text it can't read.

```javascript
// Code: rows with a WKT column to a FeatureCollection
return {
  type: 'FeatureCollection',
  features: d.map(row => ({ type: 'Feature', geometry: utils.parseWkt(row.WKT), properties: row })),
}
```

A `sql` node can do the same with `ST_GeomFromText(WKT) AS geom`.

### `cellRing(kind, id)`

The closed `[lng, lat]` ring of one grid cell. `kind` is `'h3'`, `'s2'`, `'a5'`, `'geohash'` or `'quadkey'`.

### `h3Cluster(ids)`

The merged outline of a set of H3 cells, as GeoJSON MultiPolygon coordinates.

### `osmToGeoJson(osmData)`

An Overpass API JSON answer as a GeoJSON FeatureCollection: tagged nodes as points, ways as lines (or polygons when closed), and multipolygon relations from their members.

### `interpolateGeoJsonLines(geojson, options)`

Resample every LineString in a GeoJSON value without changing the input. `options.method` is one of `utils.LINE_INTERPOLATION_METHODS`: `'linear'`, `'catmull-rom'`, `'cardinal'`, `'basis'`, `'natural'`, `'monotone-x'`, `'monotone-y'` or `'turn-radius'`. Other options: `samplesPerSegment` (default 12, at most 64), `alpha` and `tension` (0 to 1), and `turnRadiusMeters` (default 250). The Smooth Lines node does this without code.

### `choroplethJoin(rows, { geography, joinKey, geoKey })`

Async. Rows joined onto boundaries as a FeatureCollection: `geography` is `'us-states'`, `'world-countries'` or `'ca-provinces'`, `joinKey` is the rows' key column, and `geoKey` is `'name'`, `'abbrev'`, `'fips'`, `'iso2'`, `'iso3'` or `'auto'`. The Choropleth Join node does this without code.

## Distance Conversion Constants

| Constant | Value |
|----------|-------|
| `FEET_TO_METERS` | `0.3048` |
| `METER_TO_MILES` | `0.000621371` |
| `MILES_TO_METERS` | `1609.34` |

```javascript
const heightInMeters = 1000 * utils.FEET_TO_METERS  // 304.8
```

## Interpolation

### `interpolate(input, output, ease?)`

A function mapping one numeric range onto another, with optional easing.

```javascript
const altToIntensity = utils.interpolate([0, 10000], [0, 255])
altToIntensity(5000)  // 127.5

const easeInOut = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
const smoothMap = utils.interpolate([0, 100], [0, 1], easeInOut)
```

For a column, a Map Range node or `fit(x, inMin, inMax, outMin, outMax)` in an expression is faster.

## Map Styles

| Export | Value |
|--------|-------|
| `CARTO_DARK` | The CARTO Dark Matter style without labels: `https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json` |
| `BASEMAP_CATALOG` | Every built-in basemap: `{ name, url, provider, category, type, labels }` |
| `MAP_STYLES` | Each catalog URL mapped to `"<provider> <name>"`, such as `"Carto Positron"` |
| `BASEMAP_PROVIDERS`, `BASEMAP_CATEGORIES` | The catalog's providers, and its categories (`street`, `light`, `dark`, `imagery`, `terrain`, `artistic`) |
| `rasterUrlToStyle(tileUrl)` | A MapLibre style with one raster source from a tile URL template |

## Random Number Generation

### `mulberry32(seed)`

A deterministic pseudo-random number generator (Mulberry32). Returns a function that gives numbers from 0 to 1.

```javascript
// Code: the same jitter on every run
const rng = utils.mulberry32(12345)
return d.map(row => ({
  ...row,
  lng: row.lng + (rng() - 0.5) * 0.01,
  lat: row.lat + (rng() - 0.5) * 0.01,
}))
```

## Type Definitions

### `Point`

```typescript
{
  lat: number   // Latitude in degrees
  lng: number   // Longitude in degrees
  alt: number   // Altitude in meters
}
```

### `RGBA`

```typescript
{
  r: number  // Red (0-1)
  g: number  // Green (0-1)
  b: number  // Blue (0-1)
  a: number  // Alpha (0-1)
}
```

## Usage in Operators

**In a `code` node:** `d` is the input's rows, and the code returns rows or GeoJSON.

```javascript
// Arcs between all airport pairs, one row per pair with its path
const airports = [
  { name: 'JFK', lat: 40.64, lng: -73.78 },
  { name: 'LAX', lat: 33.94, lng: -118.41 },
  { name: 'ORD', lat: 41.98, lng: -87.90 }
]

return utils.cross(airports).map(([from, to]) => ({
  from: from.name,
  to: to.name,
  path: utils.getArc({
    source: { ...from, alt: 0 },
    target: { ...to, alt: 0 },
    arcHeight: 100000
  })
}))
```

A Path Layer with Position `path` draws one arc per row.

**In a `js-function` body:** the function's parameters are in scope, and it returns a number or an array of up to 4.

```javascript
// Name: intensity, Parameters: altitude
return utils.interpolate([0, 10000], [0, 1])(altitude)
```

An expression then calls it: `[intensity(altitude), 0.4, 1.0 - intensity(altitude)]`.

## See Also

- [Creating Operators](./creating-operators.md): planner operators, `code` and `js-function`
- [Expressions](../users/expressions.md): per-row values without JavaScript
