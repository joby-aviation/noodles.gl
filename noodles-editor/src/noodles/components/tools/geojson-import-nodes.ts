import { getOpEntries } from '../../store'
import type { ColumnSchema, TableSchema } from '../../table-schema'
import { edgeId, nodeId } from '../../utils/id-utils'

type GeoJsonFeature = {
  type: 'Feature'
  geometry: {
    type: string
    coordinates: unknown
  }
  properties?: Record<string, unknown>
}

export type GeoJsonData = {
  type: 'FeatureCollection'
  features: GeoJsonFeature[]
}

export type GeoJsonImportMode = 'table' | 'file'

type NodeJSON = {
  id: string
  type: string
  data: { inputs: Record<string, unknown> }
  position: { x: number; y: number }
}

type EdgeJSON = {
  id: string
  source: string
  target: string
  sourceHandle: string
  targetHandle: string
}

function findDeckId(): string {
  const existingDeck = getOpEntries().find(
    ([_, op]) => (op.constructor as { displayName?: string }).displayName === 'DeckRenderer'
  )
  return existingDeck ? existingDeck[0] : nodeId('deck', '/')
}

export function createGeoJsonFileDropNodes(
  url: string,
  basePosition: { x: number; y: number }
): { nodes: NodeJSON[]; edges: EdgeJSON[] } {
  const dataId = nodeId('data', '/')
  const geojsonLayerId = nodeId('geojson-layer', '/')
  const deckId = findDeckId()

  const nodes: NodeJSON[] = [
    {
      id: dataId,
      type: 'FileOp',
      data: {
        inputs: { format: 'json', url },
      },
      position: { x: basePosition.x, y: basePosition.y },
    },
    {
      id: geojsonLayerId,
      type: 'GeoJsonLayerOp',
      data: { inputs: {} },
      position: { x: basePosition.x + 400, y: basePosition.y },
    },
  ]

  const edges = [
    {
      source: dataId,
      target: geojsonLayerId,
      sourceHandle: 'out.data',
      targetHandle: 'par.data',
    },
    {
      source: geojsonLayerId,
      target: deckId,
      sourceHandle: 'out.layer',
      targetHandle: 'par.layers',
    },
  ].map(connection => ({ ...connection, id: edgeId(connection) }))

  return { nodes, edges }
}

export function createGeoJsonTableDropNodes(
  geojson: GeoJsonData,
  basePosition: { x: number; y: number }
): { nodes: NodeJSON[]; edges: EdgeJSON[] } {
  const tableId = nodeId('geojson-table', '/')
  const viewerId = nodeId('viewer', '/')

  const { rows, schema } = flattenGeoJsonToTable(geojson)

  const nodes: NodeJSON[] = [
    {
      id: tableId,
      type: 'TableEditorOp',
      data: {
        inputs: {
          schema,
          data: rows,
        },
      },
      position: { x: basePosition.x, y: basePosition.y },
    },
    {
      id: viewerId,
      type: 'ViewerOp',
      data: { inputs: {} },
      position: { x: basePosition.x + 600, y: basePosition.y },
    },
  ]

  const edges = [
    {
      source: tableId,
      target: viewerId,
      sourceHandle: 'out.data',
      targetHandle: 'par.data',
    },
  ].map(connection => ({ ...connection, id: edgeId(connection) }))

  return { nodes, edges }
}

export function isGeoJson(data: unknown): data is GeoJsonData {
  return (
    typeof data === 'object' &&
    data !== null &&
    'type' in data &&
    (data as { type: string }).type === 'FeatureCollection' &&
    'features' in data &&
    Array.isArray((data as GeoJsonData).features)
  )
}

function flattenGeoJsonToTable(geojson: GeoJsonData): {
  rows: Record<string, unknown>[]
  schema: TableSchema
} {
  if (geojson.features.length === 0) {
    return { rows: [], schema: { columns: [] } }
  }

  const allKeys = new Set<string>()
  for (const feature of geojson.features) {
    if (feature.properties) {
      for (const key of Object.keys(feature.properties)) {
        allKeys.add(key)
      }
    }
  }

  const rows = geojson.features.map(feature => {
    const row: Record<string, unknown> = {}

    if (feature.geometry.type === 'Point') {
      const coords = feature.geometry.coordinates as number[]
      row.geometry = [coords[0], coords[1]]
    } else {
      row.geometry = JSON.stringify(feature.geometry)
    }

    for (const key of allKeys) {
      row[key] = feature.properties?.[key] ?? null
    }

    return row
  })

  const columns: ColumnSchema[] = []

  const allPoints = geojson.features.every(f => f.geometry.type === 'Point')
  if (allPoints) {
    columns.push({ name: 'geometry', type: 'point2d', defaultValue: [0, 0] })
  } else {
    columns.push({ name: 'geometry', type: 'string', defaultValue: '' })
  }

  for (const key of allKeys) {
    const sample = geojson.features.find(f => f.properties?.[key] != null)?.properties?.[key]
    const col = inferPropertyColumn(key, sample)
    columns.push(col)
  }

  return { rows, schema: { columns } }
}

function inferPropertyColumn(name: string, sample: unknown): ColumnSchema {
  if (sample === null || sample === undefined) {
    return { name, type: 'string', defaultValue: '' }
  }
  if (typeof sample === 'number') {
    return { name, type: 'number', defaultValue: 0 }
  }
  if (typeof sample === 'boolean') {
    return { name, type: 'boolean', defaultValue: false }
  }
  if (typeof sample === 'string' && /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(sample)) {
    return { name, type: 'color', defaultValue: '#000000' }
  }
  return { name, type: 'string', defaultValue: '' }
}
