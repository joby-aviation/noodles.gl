# Utils API Reference

The `utils` object is available globally in CodeOp, AccessorOp, and ExpressionOp operators. It provides a collection of utility functions for common operations in data processing and visualization.

## Arc Geometry

Functions for generating 3D arc paths between geographic points, adapted from deck.gl's arc layer.

### `getArc(options)`

Generate 3D arc paths between two points with configurable height and smoothing.

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

Linear interpolation between two numbers.

**Parameters:**
- `from: number` - Start value
- `to: number` - End value
- `t: number` - Interpolation ratio (0-1)

**Returns:** `number` - Interpolated value

**Example:**
```javascript
utils.mix(0, 100, 0.5)  // Returns 50
```

### `mixspace(start, end, mixAmount)`

Linear interpolation across multiple ratios.

**Parameters:**
- `start: number` - Start value
- `end: number` - End value
- `mixAmount: number[]` - Array of interpolation ratios

**Returns:** `number[]` - Array of interpolated values

### `clamp(x, lower, upper)`

Constrain a value within a range.

**Parameters:**
- `x: number` - Value to clamp
- `lower: number` - Minimum value
- `upper: number` - Maximum value

**Returns:** `number` - Clamped value

**Example:**
```javascript
utils.clamp(150, 0, 100)  // Returns 100
utils.clamp(-10, 0, 100)  // Returns 0
```

### `range(stop)`

Generate array of integers from 0 to stop-1.

**Parameters:**
- `stop: number` - Exclusive upper bound

**Returns:** `number[]` - Array of integers

**Example:**
```javascript
utils.range(5)  // Returns [0, 1, 2, 3, 4]
```

### `smoothstep(edge0, edge1, x)`

Smooth interpolation using Hermite polynomial (S-curve).

**Parameters:**
- `edge0: number` - Lower edge
- `edge1: number` - Upper edge
- `x: number` - Input value

**Returns:** `number` - Smoothly interpolated value (0-1)

### `segmentRatios(segmentCount, smooth)`

Generate interpolation ratios for arc segments.

**Parameters:**
- `segmentCount?: number` - Number of segments (default: `100`)
- `smooth?: boolean` - Use smoothstep interpolation (default: `true`)

**Returns:** `number[]` - Array of ratios from 0 to 1

### `paraboloid(distance, sourceZ, targetZ, ratio, scaleHeight)`

Calculate parabolic arc height at a given ratio.

**Parameters:**
- `distance: number` - Horizontal distance
- `sourceZ: number` - Starting altitude
- `targetZ: number` - Ending altitude
- `ratio: number` - Position ratio (0-1)
- `scaleHeight?: number` - Height scale multiplier (default: `1.0`)

**Returns:** `number` - Altitude at the given ratio

### `tiltPoint(point, start, end, tilt)`

Apply tilt transformation to a point along an arc.

**Parameters:**
- `point: number[]` - Point as `[lng, lat, alt]`
- `start: Point` - Arc start point
- `end: Point` - Arc end point
- `tilt: number` - Tilt angle in degrees

**Returns:** `number[]` - Tilted point as `[lng, lat, alt]`

## Search and Data Utilities

### `binarySearchClosest(arr, val, i?)`

Find the closest value in a sorted array using binary search.

**Parameters:**
- `arr: number[]` - Sorted array to search
- `val: number` - Value to find
- `i?: number` - Optional starting index for search optimization

**Returns:** `number` - Index of the closest element

**Example:**
```javascript
const times = [0, 100, 200, 300, 400]
const idx = utils.binarySearchClosest(times, 250)  // Returns 2 (index of 200)
```

## Color Utilities

Functions for converting between color formats used in deck.gl and Theatre.js.

### `colorToRgba(color)`

Convert Deck.gl color array to RGBA object (0-1 range).

**Parameters:**
- `color: number[] | Color` - Color as `[r, g, b, a]` with values 0-255

**Returns:** `{ r, g, b, a }` - RGBA object with values 0-1

### `rgbaToColor(rgba, options?)`

Convert RGBA object (0-1 range) to Deck.gl color array (0-255).

**Parameters:**
- `rgba: { r, g, b, a? }` - RGBA object with values 0-1
- `options?: { alpha?: boolean }` - Include alpha channel (default: `true`)

**Returns:** `Color` - Deck.gl color array `[r, g, b, a]` with values 0-255

### `rgbaToClearColor(rgba)`

Convert RGBA object to WebGL clear color format.

**Parameters:**
- `rgba: { r, g, b, a? }` - RGBA object with values 0-1

**Returns:** `Color` - Clear color array `[r, g, b, a]` with values 0-1

### `hexToColor(hex, alpha?)`

Parse hex color string to Deck.gl color array.

**Parameters:**
- `hex: string` - Hex color string (e.g., `"#ff5733"`, `"#f57"`, `"#ff5733aa"`)
- `alpha?: boolean` - Include alpha channel (default: `true`)

**Returns:** `Color` - Deck.gl color array `[r, g, b, a]`

**Example:**
```javascript
utils.hexToColor('#ff5733')        // Returns [255, 87, 51, 255]
utils.hexToColor('#f57')           // Returns [255, 85, 119, 255]
utils.hexToColor('#ff5733', false) // Returns [255, 87, 51]
```

### `colorToHex(color, alpha?)`

Convert Deck.gl color array to hex string.

**Parameters:**
- `color: Color` - Deck.gl color array
- `alpha?: boolean` - Include alpha channel (default: `true`)

**Returns:** `string` - Hex color string

**Example:**
```javascript
utils.colorToHex([255, 87, 51, 255])        // Returns "#ff5733ff"
utils.colorToHex([255, 87, 51, 255], false) // Returns "#ff5733"
```

### `hexToRgba(hex)`

Parse hex color string to RGBA object.

**Parameters:**
- `hex: string` - Hex color string

**Returns:** `{ r, g, b, a }` - RGBA object with values 0-1

### `rgbaToHex(rgba)`

Convert RGBA object to hex string (without alpha).

**Parameters:**
- `rgba: { r, g, b, a? }` - RGBA object with values 0-1

**Returns:** `string` - Hex color string

## Array Utilities

### `cross(arr)`

Generate all unique pairs from an array (combinations without repetition).

**Parameters:**
- `arr: T[]` - Input array

**Returns:** `[T, T][]` - Array of all unique pairs

**Example:**
```javascript
const cities = ['NYC', 'LA', 'CHI']
const routes = utils.cross(cities)
// Returns: [['NYC', 'LA'], ['NYC', 'CHI'], ['LA', 'CHI']]
```

## Geospatial Utilities

### `getDirections(options)`

Async function to get routing directions between two points using Mapbox or Google Maps APIs.

**Parameters:**
- `origin: { lat, lng }` - Starting point coordinates
- `destination: { lat, lng }` - Ending point coordinates
- `mode?: 'driving' | 'transit'` - Transportation mode (default: `'driving'`)

**Returns:** `Promise<AnimatedDirections>` - Object containing:
  - `distance: number` - Total distance in meters
  - `duration: number` - Total duration in seconds
  - `durationFormatted: string` - Human-readable duration
  - `path: number[][]` - Array of `[lng, lat]` coordinates
  - `timestamps: number[]` - Timestamp for each point (for driving mode)

**Constants:**
- `DRIVING` - Constant for driving mode
- `TRANSIT` - Constant for transit mode

**Example:**
```javascript
const route = await utils.getDirections({
  origin: { lat: 40.7128, lng: -74.0060 },      // NYC
  destination: { lat: 34.0522, lng: -118.2437 }, // LA
  mode: utils.DRIVING
})
console.log(route.durationFormatted)  // "45 hours, 30 mins"
console.log(route.path.length)        // Number of points in route
```

**Note:** Requires `VITE_MAPBOX_ACCESS_TOKEN` or `VITE_GOOGLE_MAPS_API_KEY` environment variable.

## Distance Conversion Constants

Constants for converting between distance units.

### `FEET_TO_METERS`

Conversion factor from feet to meters: `0.3048`

**Example:**
```javascript
const heightInFeet = 1000
const heightInMeters = heightInFeet * utils.FEET_TO_METERS  // 304.8
```

### `METER_TO_MILES`

Conversion factor from meters to miles: `0.000621371`

**Example:**
```javascript
const distanceInMeters = 5000
const distanceInMiles = distanceInMeters * utils.METER_TO_MILES  // ~3.11
```

### `MILES_TO_METERS`

Conversion factor from miles to meters: `1609.34`

**Example:**
```javascript
const distanceInMiles = 10
const distanceInMeters = distanceInMiles * utils.MILES_TO_METERS  // 16093.4
```

## Interpolation

### `interpolate(input, output, ease?)`

Create a mapping function between two numerical ranges with optional easing.

**Parameters:**
- `input: [number, number]` - Input range `[min, max]`
- `output: [number, number]` - Output range `[min, max]`
- `ease?: (v: number) => number` - Optional easing function

**Returns:** `(inputValue: number) => number` - Mapping function

**Example:**
```javascript
// Map altitude (0-10000m) to color intensity (0-255)
const altToIntensity = utils.interpolate([0, 10000], [0, 255])
const intensity = altToIntensity(5000)  // Returns 127.5

// Map with custom easing
const easeInOut = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
const smoothMap = utils.interpolate([0, 100], [0, 1], easeInOut)
```

## Map Styles

Predefined basemap URLs from CartoDB.

### `CARTO_DARK`

URL for CartoDB dark basemap without labels:
```
https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json
```

**Example:**
```javascript
const basemapUrl = utils.CARTO_DARK
```

### `MAP_STYLES`

Object mapping basemap URLs to readable names. Available styles:
- `Streets` - Positron with labels
- `Light` - Positron without labels
- `Dark` - Dark matter with labels
- `Dark-NoLabels` - Dark matter without labels
- `Voyager` - Voyager with labels
- `Voyager-NoLabels` - Voyager without labels

**Example:**
```javascript
const styleName = utils.MAP_STYLES['https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json']
// Returns: "Dark"
```

## Random Number Generation

### `mulberry32(seed)`

Create a deterministic pseudo-random number generator (PRNG) using the Mulberry32 algorithm.

**Parameters:**
- `seed: number` - Seed value for deterministic generation

**Returns:** `() => number` - Function that generates random numbers between 0 and 1

**Example:**
```javascript
// Generate deterministic random positions with jitter
const rng = utils.mulberry32(12345)
const positions = data.map(d => [
  d.lng + (rng() - 0.5) * 0.01,  // Add random jitter
  d.lat + (rng() - 0.5) * 0.01
])

// Same seed always produces same sequence
const rng1 = utils.mulberry32(42)
const rng2 = utils.mulberry32(42)
console.log(rng1() === rng2())  // true
```

## Type Definitions

### `Point`

Geographic point with altitude:
```typescript
{
  lat: number   // Latitude in degrees
  lng: number   // Longitude in degrees
  alt: number   // Altitude in meters
}
```

### `AnimatedDirections`

Routing result with timing information:
```typescript
{
  distance: number           // Total distance in meters
  duration: number           // Total duration in seconds
  durationFormatted: string  // Human-readable duration
  path: number[][]           // Array of [lng, lat] coordinates
  timestamps: number[]       // Timestamp for each point (ms)
}
```

### `RGBA`

RGBA color object with 0-1 range:
```typescript
{
  r: number  // Red (0-1)
  g: number  // Green (0-1)
  b: number  // Blue (0-1)
  a: number  // Alpha (0-1)
}
```

## Usage in Operators

The `utils` object is automatically available in:

- **CodeOp** - Multi-line JavaScript code
- **AccessorOp** - Per-item accessor functions
- **ExpressionOp** - Single-line expressions

**Example in CodeOp:**
```javascript
// Create arcs between all airport pairs
const airports = [
  { name: 'JFK', lat: 40.64, lng: -73.78 },
  { name: 'LAX', lat: 33.94, lng: -118.41 },
  { name: 'ORD', lat: 41.98, lng: -87.90 }
]

const arcs = utils.cross(airports).map(([from, to]) => ({
  from: [from.lng, from.lat],
  to: [to.lng, to.lat],
  path: utils.getArc({
    source: { ...from, alt: 0 },
    target: { ...to, alt: 0 },
    arcHeight: 100000
  })
}))

return arcs
```

**Example in AccessorOp:**
```javascript
// Color based on altitude with interpolation
const altToColor = utils.interpolate([0, 10000], [0, 255])
const intensity = altToColor(d.altitude)
return [intensity, 100, 255 - intensity]
```

## See Also

- [Creating Operators](./creating-operators.md) - Guide to creating custom operators including CodeOp and AccessorOp
