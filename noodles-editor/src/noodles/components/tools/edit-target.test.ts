import type { DocEdge, DocNode, EditorDoc } from '@noodles.gl/planner'
import { describe, expect, it } from 'vitest'
import { readTargetFeatures, resolveEditTarget, writeTargetFeatures } from './edit-target'

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

const node = (id: string, op: string, params: DocNode['params'] = {}): DocNode => ({
  id,
  op,
  x: 0,
  y: 0,
  params,
})

function doc(nodes: DocNode[], edges: DocEdge[] = [], tracks: string[] = []): EditorDoc {
  return {
    version: 1,
    name: 'edit',
    nodes,
    edges,
    timeline: { length: 10, fps: 30, tracks: tracks.map(target => ({ target, keyframes: [] })) },
  }
}

const wire = (source: string, target: string, targetPort = 'in'): DocEdge => ({
  id: `${source}-${target}-${targetPort}`,
  source,
  sourcePort: 'out',
  target,
  targetPort,
})

describe('resolveEditTarget', () => {
  const shapes = node('shapes', 'features', {
    geojson: JSON.stringify({ type: 'FeatureCollection', features: [square] }),
  })
  const pin = node('pin', 'point', { lng: -122.4, lat: 37.8 })
  const fill = node('fill', 'polygon')
  const color = node('color', 'attribute', { name: 'color', expression: '[255, 0, 0]' })
  const k = node('k', 'number', { value: 3 })

  it('edits features and point nodes directly', () => {
    const d = doc([shapes, pin])
    expect(resolveEditTarget(d, 'shapes')).toEqual({ nodeId: 'shapes', kind: 'features' })
    expect(resolveEditTarget(d, 'pin')).toEqual({ nodeId: 'pin', kind: 'point' })
  })

  it('hands a layer edit to the features it draws, through table steps', () => {
    const d = doc([shapes, color, fill], [wire('shapes', 'color'), wire('color', 'fill')])
    expect(resolveEditTarget(d, 'fill')).toEqual({ nodeId: 'shapes', kind: 'features' })
  })

  it('locks a target that a wire, an expression, a reference or keyframes drive', () => {
    const wired = doc([k, pin], [wire('k', 'pin', 'par:lng')])
    expect(resolveEditTarget(wired, 'pin')?.locked).toMatch(/connection/)
    const expr = doc([node('pin', 'point', { lng: { expr: 'T' } })])
    expect(resolveEditTarget(expr, 'pin')?.locked).toMatch(/expression/)
    expect(writeTargetFeatures(expr, { nodeId: 'pin', kind: 'point' }, [square])).toBe(false)
    const ref = doc([k, node('pin', 'point', { lat: { ref: 'k/value' } })])
    expect(resolveEditTarget(ref, 'pin')?.locked).toMatch(/reference/)
    const keyed = doc([pin], [], ['pin.lat'])
    expect(resolveEditTarget(keyed, 'pin')?.locked).toMatch(/keyframed/)
    const wkt = doc([node('shapes', 'features', { geojson: 'POINT (1 2)' })])
    expect(resolveEditTarget(wkt, 'shapes')?.locked).toMatch(/WKT/)
  })

  it('ignores layers fed by anything else, and other nodes', () => {
    const sql = node('sql', 'sql', { query: 'SELECT 1' })
    expect(resolveEditTarget(doc([sql, fill], [wire('sql', 'fill')]), 'fill')).toBeNull()
    expect(resolveEditTarget(doc([fill]), 'fill')).toBeNull()
    expect(resolveEditTarget(doc([k]), 'k')).toBeNull()
  })
})

describe('reading and writing geometry', () => {
  const features = { nodeId: 'f', kind: 'features' as const }

  it('reads every form a features node accepts', () => {
    const read = (geojson: string) =>
      readTargetFeatures(doc([node('f', 'features', { geojson })]), features)
    expect(read(JSON.stringify({ type: 'FeatureCollection', features: [square] }))).toEqual([
      square,
    ])
    expect(read(JSON.stringify(square.geometry))[0].geometry).toEqual(square.geometry)
    expect(read('{not json')).toEqual([])
    // A node left at its default holds an empty collection
    expect(readTargetFeatures(doc([node('f', 'features')]), features)).toEqual([])
  })

  it('writes a FeatureCollection back, keeping properties', () => {
    const d = doc([node('f', 'features')])
    expect(writeTargetFeatures(d, features, [square])).toBe(true)
    expect(JSON.parse(d.nodes[0].params.geojson as string)).toEqual({
      type: 'FeatureCollection',
      features: [square],
    })
  })

  it('reads and writes a point as its longitude and latitude', () => {
    const d = doc([node('p', 'point', { lng: -122.4, lat: 37.8 })])
    const target = { nodeId: 'p', kind: 'point' as const }
    expect(readTargetFeatures(d, target)[0].geometry).toEqual({
      type: 'Point',
      coordinates: [-122.4, 37.8],
    })
    const moved: GeoJSON.Feature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-122, 38] },
      properties: {},
    }
    expect(writeTargetFeatures(d, target, [moved])).toBe(true)
    expect(d.nodes[0].params).toEqual({ lng: -122, lat: 38 })
    expect(writeTargetFeatures(d, target, [square])).toBe(false)
  })
})
