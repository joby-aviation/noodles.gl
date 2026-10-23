// What the map tools and the GIS wizard add to a document. Draw and Measure keep their geometry
// in a Features node, drawn as fill, outline and points; Point adds a Point node; a GIS recipe
// becomes the planner operator its Noodles operator converts to (gis-conversions.ts), wired to
// the outputs the user picked, and drawn when they ask.

import { type EditorDoc, OPERATOR_INDEX, type ParamValue } from '@noodles.gl/planner'
import type { GeoRecipe, SourceRef } from '../noodles/components/tools/geo-recipes'
import { DECK_OP_FOR } from '../runtime/deck-ops'
import { GIS_CONVERSIONS } from '../runtime/migrate/gis-conversions'
import { type Built, DocBuilder, type FeatureStyle, SHAPE_STYLE } from './doc-builder'

export interface ToolOptions {
  doc: EditorDoc
  basePosition: { x: number; y: number }
  /** The network the nodes go in; undefined is the root. */
  network?: string
}

const MEASURE_STYLE: FeatureStyle = { fill: [245, 158, 11], line: [245, 158, 11] }

/** Drawn features, kept as GeoJSON in a Features node and drawn in the deck. */
export function drawingDoc(
  { doc, basePosition, network }: ToolOptions,
  features: GeoJSON.Feature[],
  style: FeatureStyle = SHAPE_STYLE
): Built {
  const b = new DocBuilder(doc, basePosition, network)
  const drawn = b.add('features', 'drawing', 0, 0, {
    geojson: JSON.stringify({ type: 'FeatureCollection', features }, null, 2),
  })
  b.drawFeatures({ id: drawn, port: 'out' }, 300, style)
  return b.built(drawn)
}

/** A measured path, or a closed one as a polygon, drawn like a drawing in amber. */
export function measurementDoc(
  options: ToolOptions,
  points: { lng: number; lat: number }[],
  closed: boolean
): Built {
  const coordinates = points.map(p => [p.lng, p.lat])
  const geometry: GeoJSON.Geometry = closed
    ? { type: 'Polygon', coordinates: [[...coordinates, coordinates[0]]] }
    : { type: 'LineString', coordinates }
  return drawingDoc(
    options,
    [{ type: 'Feature', geometry, properties: { source: 'measure' } }],
    MEASURE_STYLE
  )
}

/** A Point node at a place, for other nodes to read. */
export function pointDoc(
  { doc, basePosition, network }: ToolOptions,
  lng: number,
  lat: number
): Built {
  const b = new DocBuilder(doc, basePosition, network)
  return b.built(b.add('point', 'point', 0, 0, { lng, lat }))
}

/** A recipe's answers as the Noodles inputs its conversion reads: a bbox as two corners. */
function noodlesInputs(
  recipe: GeoRecipe,
  values: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const param of recipe.params) {
    const v = values[param.key] ?? param.default
    if (param.type === 'bbox' && Array.isArray(v) && v.length === 4) {
      const [west, south, east, north] = v as number[]
      out[param.key] = {
        southwest: { lng: west, lat: south },
        northeast: { lng: east, lat: north },
      }
    } else {
      out[param.key] = v
    }
  }
  return out
}

export interface RecipeDocOptions extends ToolOptions {
  recipe: GeoRecipe
  values: Record<string, unknown>
  /** Recipe input -> the document output it reads, or null to leave it unwired. */
  sources?: Record<string, SourceRef | null>
  /** Draw the result, when it is features. */
  addLayer?: boolean
}

/**
 * A GIS recipe as document nodes: the planner operator its Noodles operator converts to, with
 * the recipe's answers as parameters and its inputs wired from the chosen outputs.
 */
export function recipeDoc({
  doc,
  basePosition,
  network,
  recipe,
  values,
  sources = {},
  addLayer = false,
}: RecipeDocOptions): Built {
  const b = new DocBuilder(doc, basePosition, network)
  const inputs = noodlesInputs(recipe, values)
  const wireInputs = (node: string, ports: Record<string, string>) => {
    for (const input of recipe.inputs) {
      const ref = sources[input.key]
      const port = ports[input.key]
      if (ref && port) b.wire(ref.source, ref.sourceHandle, node, port)
    }
  }
  const finish = (node: string, port: string | undefined) => {
    if (addLayer && recipe.layerable && port) b.drawFeatures({ id: node, port }, 450)
    return b.built(node)
  }

  const conversion = GIS_CONVERSIONS[recipe.opType]
  if (conversion) {
    const node = b.add(conversion.op, recipe.nodeName.replace(/-/g, '_'), 0, 0, {
      ...conversion.params({ ...conversion.defaults, ...inputs }),
    })
    wireInputs(node, conversion.inputs)
    const outputs =
      typeof conversion.outputs === 'function'
        ? conversion.outputs({ ...conversion.defaults, ...inputs })
        : conversion.outputs
    return finish(node, outputs[recipe.output])
  }

  // Readers: DuckDB reads GeoParquet's geometry and a shapefile itself
  if (recipe.opType === 'GeoParquetOp') {
    const url = String(inputs.url ?? '').replace(/'/g, "''")
    const column = `"${String(inputs.geometryColumn || 'geometry').replace(/"/g, '""')}"`
    const limit = Math.floor(Number(inputs.limit) || 0)
    const node = b.add('sql', recipe.nodeName, 0, 0, {
      query: `SELECT * EXCLUDE (${column}), ${column}::GEOMETRY AS geom FROM read_parquet('${url}')${limit > 0 ? ` LIMIT ${limit}` : ''}`,
    })
    return finish(node, 'out')
  }
  if (recipe.opType === 'ShapefileOp') {
    const node = b.add('geojson', recipe.nodeName, 0, 0, { url: String(inputs.url ?? '') })
    return finish(node, 'features')
  }

  // A tile source: a deck operator with the recipe's answers as its parameters
  const deck = DECK_OP_FOR.get(recipe.opType)
  if (deck) {
    const names = new Set(deck.def.params.map(p => p.name))
    const params = Object.fromEntries(
      Object.entries(inputs).filter(([k]) => names.has(k))
    ) as Record<string, ParamValue>
    return b.built(b.add(deck.def.type, recipe.nodeName, 0, 0, params))
  }
  throw new Error(`${recipe.name} has no document operator`)
}

/** Outputs a recipe can read: every table a node makes, by name, features first. */
export function sourceOptions(
  doc: EditorDoc,
  hasGeometry: (nodeId: string, port: string) => boolean
): { value: SourceRef; label: string; geometry: boolean }[] {
  const options: { value: SourceRef; label: string; geometry: boolean }[] = []
  for (const n of doc.nodes) {
    for (const port of OPERATOR_INDEX.get(n.op)?.outputs ?? []) {
      if (port.type !== 'table') continue
      options.push({
        value: { source: n.id, sourceHandle: port.name },
        label: `${n.name ?? n.id} → ${port.name}`,
        geometry: hasGeometry(n.id, port.name),
      })
    }
  }
  return options.sort(
    (a, b) => Number(b.geometry) - Number(a.geometry) || a.label.localeCompare(b.label)
  )
}
