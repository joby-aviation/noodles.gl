import { describe, expect, it, vi } from 'vitest'
import {
  type EditableOp,
  readTargetFeatures,
  resolveEditTarget,
  writeTargetFeatures,
} from './edit-target'

// Operators carry their display name on the class, reached through `constructor`
function fakeOp(id: string, displayName: string, inputs: Record<string, unknown> = {}) {
  return { id, inputs, constructor: { displayName } } as EditableOp
}

function field(value: unknown) {
  const f = { value, setValue: vi.fn((next: unknown) => (f.value = next)) }
  return f
}

const square: GeoJSON.Feature = {
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 0],
      ],
    ],
  },
  properties: { name: 'zone' },
}

describe('resolveEditTarget', () => {
  const editor = fakeOp('/geo-editor', 'GeoEditor')
  const point = fakeOp('/point', 'Point')
  const layer = fakeOp('/drawn-layer', 'GeoJsonLayer')
  const other = fakeOp('/number', 'Number')
  const ops = new Map([editor, point, layer, other].map(op => [op.id, op]))
  const getOp = (id: string) => ops.get(id)

  it('edits GeoEditor and Point nodes directly', () => {
    expect(resolveEditTarget('/geo-editor', getOp, [])).toEqual({
      opId: '/geo-editor',
      kind: 'geo-editor',
    })
    expect(resolveEditTarget('/point', getOp, [])).toEqual({ opId: '/point', kind: 'point' })
  })

  it('hands a layer edit to the GeoEditor wired into its Data input', () => {
    const edges = [{ source: '/geo-editor', target: '/drawn-layer', targetHandle: 'par.data' }]
    expect(resolveEditTarget('/drawn-layer', getOp, edges)).toEqual({
      opId: '/geo-editor',
      kind: 'geo-editor',
    })
  })

  it('ignores layers fed by anything else, and other nodes', () => {
    const edges = [{ source: '/number', target: '/drawn-layer', targetHandle: 'par.data' }]
    expect(resolveEditTarget('/drawn-layer', getOp, edges)).toBeNull()
    expect(resolveEditTarget('/drawn-layer', getOp, [])).toBeNull()
    expect(resolveEditTarget('/number', getOp, [])).toBeNull()
  })
})

describe('reading and writing geometry', () => {
  it('reads every form a GeoEditor accepts', () => {
    const asCollection = fakeOp('/a', 'GeoEditor', {
      geojson: field(JSON.stringify({ type: 'FeatureCollection', features: [square] })),
    })
    const asGeometry = fakeOp('/b', 'GeoEditor', {
      geojson: field(JSON.stringify(square.geometry)),
    })
    const broken = fakeOp('/c', 'GeoEditor', { geojson: field('{not json') })
    expect(readTargetFeatures(asCollection, 'geo-editor')).toEqual([square])
    expect(readTargetFeatures(asGeometry, 'geo-editor')[0].geometry).toEqual(square.geometry)
    expect(readTargetFeatures(broken, 'geo-editor')).toEqual([])
  })

  it('writes a FeatureCollection back to a GeoEditor, keeping properties', () => {
    const geojson = field('{}')
    const op = fakeOp('/a', 'GeoEditor', { geojson })
    expect(writeTargetFeatures(op, 'geo-editor', [square])).toBe(true)
    expect(JSON.parse(geojson.value as string)).toEqual({
      type: 'FeatureCollection',
      features: [square],
    })
  })

  it('reads and writes a Point node as lng/lat', () => {
    const coordinates = field({ lng: -122.4, lat: 37.8 })
    const op = fakeOp('/p', 'Point', { coordinates })
    expect(readTargetFeatures(op, 'point')[0].geometry).toEqual({
      type: 'Point',
      coordinates: [-122.4, 37.8],
    })
    const moved: GeoJSON.Feature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-122, 38] },
      properties: {},
    }
    expect(writeTargetFeatures(op, 'point', [moved])).toBe(true)
    expect(coordinates.value).toEqual({ lng: -122, lat: 38 })
    expect(writeTargetFeatures(op, 'point', [square])).toBe(false)
  })
})
