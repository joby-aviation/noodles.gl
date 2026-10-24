// Friendly names and descriptions for operator fields in the UI.
//
// A field's key (e.g. `getSourcePosition`) stays the identifier in edges, references and
// expressions. For display, a field can declare `label` and `description` options; without
// them the label is the humanized key, and layer operators fall back to the shared deck.gl
// prop descriptions below.

import { LayerField } from '../fields'

export type FieldDocs = {
  label: string
  description?: string
}

const ACRONYMS = new Set([
  '2d',
  '3d',
  'a5',
  'api',
  'csv',
  'css',
  'gpu',
  'h3',
  'html',
  'id',
  'json',
  'kml',
  'lod',
  'rgb',
  'rgba',
  's2',
  'sql',
  'url',
  'utc',
  'xyz',
])

// Words whose casing isn't plain uppercase
const WORD_CASE: Record<string, string> = {
  geojson: 'GeoJSON',
  geoparquet: 'GeoParquet',
  pmtiles: 'PMTiles',
}

// `getSourcePosition` -> `Source position`, `tilesetUrl` -> `Tileset URL`, `_full3d` -> `Full 3D`
export function humanizeFieldName(name: string): string {
  const words = name
    .replace(/^_+/, '')
    .replace(/^get(?=[A-Z0-9])/, '')
    .replace(/([a-z])(\d+[a-z]$)/i, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(word => {
      const lower = word.toLowerCase()
      if (WORD_CASE[lower]) return WORD_CASE[lower]
      return ACRONYMS.has(lower) ? word.toUpperCase() : lower
    })

  if (words.length === 0) return name
  const [first, ...rest] = words
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ')
}

// deck.gl props mean the same thing on every layer that has them, so they're described once.
// Unit references ("in Width units") name the humanized label of the matching units field.
export const LAYER_FIELD_DOCS: Record<string, Partial<FieldDocs>> = {
  data: { description: 'Rows to draw, one shape per row. Connect a table, array or GeoJSON.' },
  visible: { description: 'Show or hide this layer.' },
  opacity: { description: 'Layer transparency, from 0 (invisible) to 1 (solid).' },
  pickable: { description: 'Respond to hover and click.' },
  parameters: {
    label: 'Render parameters',
    description: 'Low-level GPU draw settings, such as depth testing.',
  },
  extensions: { description: 'Add deck.gl extensions, such as data filtering or dashed lines.' },

  // Position and geometry
  getPosition: { description: 'Where each item is placed, as [longitude, latitude, altitude].' },
  getSourcePosition: { description: 'Where each arc or line starts.' },
  getTargetPosition: { description: 'Where each arc or line ends.' },
  getPath: { description: 'The positions that make up each path.' },
  getPolygon: { description: 'The outline coordinates of each polygon.' },
  getNormal: { description: 'Surface direction of each point, used for lighting.' },
  bounds: { description: 'Where to place the image, as [west, south, east, north].' },
  wrapLongitude: { description: 'Draw shapes that cross the 180th meridian correctly.' },

  // Color
  getColor: { description: 'Color of each item.' },
  getFillColor: { description: 'Fill color of each shape.' },
  getLineColor: { description: 'Outline color of each shape.' },
  getSourceColor: { description: 'Color at the start of each arc or line.' },
  getTargetColor: { description: 'Color at the end of each arc or line.' },
  colorRange: { description: 'Colors used from low to high values.' },
  colorDomain: {
    description: "Values mapped to the first and last color. Empty uses the data's range.",
  },

  // Fill and outline
  filled: { description: 'Fill the inside of each shape.' },
  stroked: { description: 'Draw an outline around each shape.' },
  extruded: { description: 'Raise shapes into 3D using their elevation.' },
  wireframe: { description: 'Draw the edges of extruded shapes.' },
  antialiasing: { description: 'Smooth jagged edges. Costs some performance.' },
  lineAntialiasing: { description: 'Smooth jagged outline edges. Costs some performance.' },
  billboard: { description: 'Always face the camera instead of lying flat on the map.' },
  capRounded: { description: 'Round the ends of each line.' },
  jointRounded: { description: 'Round the corners where line segments meet.' },
  lineJointRounded: { description: 'Round the corners where outline segments meet.' },

  // Size
  getWidth: { description: 'Width of each item, in Width units.' },
  widthUnits: { description: 'Units for Width: meters, screen pixels, or common (world) units.' },
  widthScale: { description: 'Multiplier applied to every width.' },
  widthMinPixels: { description: 'Never draw thinner than this many pixels.' },
  widthMaxPixels: { description: 'Never draw wider than this many pixels.' },
  getLineWidth: { description: 'Outline width of each shape, in Line width units.' },
  lineWidthUnits: { description: 'Units for Line width: meters, screen pixels, or common units.' },
  lineWidthScale: { description: 'Multiplier applied to every outline width.' },
  lineWidthMinPixels: { description: 'Never draw outlines thinner than this many pixels.' },
  lineWidthMaxPixels: { description: 'Never draw outlines wider than this many pixels.' },
  getRadius: { description: 'Radius of each item, in Radius units.' },
  radiusUnits: { description: 'Units for Radius: meters, screen pixels, or common units.' },
  radiusScale: { description: 'Multiplier applied to every radius.' },
  radiusMinPixels: { description: 'Never draw smaller than this many pixels.' },
  radiusMaxPixels: { description: 'Never draw larger than this many pixels.' },
  getPointRadius: { description: 'Radius of each point, in Point radius units.' },
  pointRadiusUnits: {
    description: 'Units for Point radius: meters, screen pixels, or common units.',
  },
  getSize: { description: 'Size of each item, in Size units.' },
  sizeUnits: { description: 'Units for Size: meters, screen pixels, or common units.' },
  sizeScale: { description: 'Multiplier applied to every size.' },
  sizeMinPixels: { description: 'Never draw smaller than this many pixels.' },
  sizeMaxPixels: { description: 'Never draw larger than this many pixels.' },
  pointSize: { description: 'Size of each point, in pixels.' },
  getElevation: { description: 'Height of each extruded shape. Needs Extruded turned on.' },
  elevationScale: { description: 'Multiplier applied to every elevation.' },

  // Arcs
  getHeight: { description: "Height of each arc's peak, relative to its length." },
  getTilt: { description: 'Sideways tilt of each arc, in degrees.' },
  greatCircle: { description: 'Follow the curve of the earth instead of a straight arc.' },

  // Text and icons
  getText: { description: 'Text to show for each item.' },
  getAngle: { description: 'Rotation of each item, in degrees.' },
  getPixelOffset: { description: 'Screen offset of each item, as [x, y] pixels.' },
  getTextAnchor: { description: 'Horizontal alignment: start, middle or end.' },
  getAlignmentBaseline: { description: 'Vertical alignment: top, center or bottom.' },
  getIcon: { description: 'Icon name for each item, from the icon mapping.' },
  iconAtlas: { description: 'Image that holds all the icons.' },
  iconMapping: { description: 'Where each icon sits in the icon atlas.' },

  // Aggregation
  getWeight: { description: 'How much each item counts toward its cell.' },
  cellSize: { description: 'Size of each cell, in meters.' },
  coverage: { description: 'How much of each cell is filled, from 0 to 1.' },
  aggregation: { description: 'How values in a cell are combined: sum, mean, min or max.' },
  gpuAggregation: { description: 'Aggregate on the GPU. Faster for large data.' },
  upperPercentile: { description: 'Hide cells with values above this percentile.' },
  lowerPercentile: { description: 'Hide cells with values below this percentile.' },
  radiusPixels: { description: 'Blur radius around each point, in pixels.' },
  intensity: { description: 'Multiplier applied to every heat value.' },
  threshold: { description: 'Hide heat below this fraction of the maximum.' },

  // Trips
  getTimestamps: { description: 'Time of each position along the path.' },
  currentTime: { description: 'The moment to draw. Animate this to move the trips.' },
  trailLength: { description: 'How long a trail stays visible behind the current time.' },
  fadeTrail: { description: 'Fade each trail out toward its tail.' },

  // Images and tiles
  image: { description: 'Image to draw.' },
  texture: { description: 'Image draped over each shape.' },
  tileSize: { description: 'Size of each tile, in pixels.' },
  minZoom: { description: 'Load tiles only at or above this zoom level.' },
  maxZoom: { description: 'Load tiles only at or below this zoom level.' },
}

type OperatorLike = { outputs: Record<string, unknown> }

function isLayerOperator(op: OperatorLike | undefined): boolean {
  return !!op && Object.values(op.outputs).some(output => output instanceof LayerField)
}

// Takes the field structurally: Field's generics don't make every subclass assignable to Field
type FieldLike = { label?: string; description?: string }

export function getFieldDocs(name: string, field: FieldLike, op?: OperatorLike): FieldDocs {
  const shared = isLayerOperator(op) ? LAYER_FIELD_DOCS[name] : undefined
  return {
    label: field.label ?? shared?.label ?? humanizeFieldName(name),
    description: field.description ?? shared?.description,
  }
}
