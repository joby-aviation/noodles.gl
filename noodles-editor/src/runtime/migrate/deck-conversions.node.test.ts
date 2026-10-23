// Views, widgets, extensions, tile layers and values: what a deck draws without rows.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { lowerDocument } from '@noodles.gl/planner'
import { beforeAll, describe, expect, it } from 'vitest'
import { registerDeckOperators } from '../deck-ops'
import { VALUE_OPS } from '../value-ops'
import {
  MigrationError,
  type NoodlesEdge,
  type NoodlesNode,
  type NoodlesProject,
  toEditorDoc,
} from './to-editor-doc'

beforeAll(() => registerDeckOperators())

const example = (name: string) =>
  JSON.parse(readFileSync(resolve(`src/examples/${name}/noodles.json`), 'utf8')) as NoodlesProject
const op = (id: string, type: string, inputs: Record<string, unknown> = {}): NoodlesNode => ({
  id,
  type,
  data: { inputs },
})
const wire = (source: string, out: string, target: string, field: string): NoodlesEdge => ({
  id: `${source}.${out}->${target}.${field}`,
  source,
  sourceHandle: `out.${out}`,
  target,
  targetHandle: `par.${field}`,
})
const deck = (nodes: NoodlesNode[], edges: NoodlesEdge[], timeline?: unknown): NoodlesProject => ({
  version: 18,
  nodes: [...nodes, op('/deck', 'DeckRendererOp'), op('/out', 'OutOp')],
  edges: [...edges, wire('/deck', 'vis', '/out', 'vis')],
  ...(timeline ? { timeline } : {}),
})

describe('deck operators', () => {
  it('convert the examples’ views, cameras and tile layers', () => {
    const orbit = toEditorDoc(example('orbit')).doc
    expect(orbit.nodes.find(n => n.id === '/camera')).toMatchObject({
      op: 'orbit-view',
      params: { clear: true, clearColor: '#2997ffff', fovy: 50 },
    })
    expect(lowerDocument(orbit).errors).toEqual([])
    const chargers = toEditorDoc(example('chargers')).doc
    expect(chargers.nodes.find(n => n.id === '/auto-view')?.op).toBe('view-state')
    // BoundingBox reads the canvas size, so it stays on the host
    expect(chargers.nodes.find(n => n.id === '/charger-bounds')?.op).toBe('BoundingBoxOp')
    expect(chargers.edges).toContainEqual(
      expect.objectContaining({
        source: '/charger-bounds',
        sourcePort: 'longitude',
        target: '/auto-view',
        targetPort: 'par:longitude',
      })
    )
    const hubble = toEditorDoc(example('cesium-hubble')).doc
    expect(hubble.nodes.find(n => n.id === '/point-cloud')).toMatchObject({
      op: 'tile-3d',
      params: { provider: 'Cesium' },
    })
  })

  it('list a layer’s extensions in order, and a legend’s ramp by its scheme', () => {
    const { doc } = toEditorDoc(
      deck(
        [
          op('/image', 'BitmapLayerOp', { image: 'https://x/a.png' }),
          op('/bright', 'BrightnessContrastExtensionOp', { brightness: 0.3 }),
          op('/vivid', 'VibranceExtensionOp'),
          op('/ramp', 'ColorRampOp', { colorScheme: 'magma' }),
          op('/legend', 'LegendWidgetOp', { label: 'Depth' }),
        ],
        [
          wire('/bright', 'extension', '/image', 'extensions'),
          wire('/vivid', 'extension', '/image', 'extensions'),
          wire('/image', 'layer', '/deck', 'layers'),
          wire('/ramp', 'colorRamp', '/legend', 'colorRamp'),
          wire('/legend', 'widget', '/deck', 'widgets'),
        ]
      )
    )
    const into = doc.edges.filter(e => e.target === '/image' && e.targetPort === 'par:extensions')
    expect(into.map(e => [e.source, e.index])).toEqual([
      ['/bright', 0],
      ['/vivid', 1],
    ])
    expect(doc.nodes.find(n => n.id === '/legend')).toMatchObject({
      op: 'legend-widget',
      params: { label: 'Depth', colorScheme: 'magma' },
    })
    expect(doc.nodes.some(n => n.id === '/ramp')).toBe(false)
    expect(lowerDocument(doc).errors).toEqual([])
  })
})

describe('values', () => {
  it('are computed from literal inputs and written into what reads them', () => {
    const { doc } = toEditorDoc(
      deck(
        [
          op('/xy', 'CombineXYOp', { x: -73.5, y: 40.25 }),
          op('/split', 'SplitXYOp'),
          op('/green', 'HSLOp', { h: 120, s: 1, l: 0.5 }),
          op('/camera', 'MapViewStateOp', { zoom: 9 }),
          op('/view', 'MapViewOp'),
          op('/bg', 'OrthographicViewOp'),
        ],
        [
          wire('/xy', 'xy', '/split', 'vec'),
          wire('/split', 'x', '/camera', 'longitude'),
          wire('/split', 'y', '/camera', 'latitude'),
          wire('/camera', 'viewState', '/view', 'viewState'),
          wire('/green', 'color', '/bg', 'clearColor'),
          wire('/view', 'view', '/deck', 'views'),
          wire('/bg', 'view', '/deck', 'views'),
        ]
      )
    )
    expect(doc.nodes.find(n => n.id === '/camera')?.params).toMatchObject({
      longitude: -73.5,
      latitude: 40.25,
      zoom: 9,
    })
    expect(doc.nodes.find(n => n.id === '/bg')?.params.clearColor).toBe('#00ff00')
    expect(doc.nodes.map(n => n.id)).not.toContain('/split')
    expect(doc.nodes.map(n => n.id)).not.toContain('/xy')
  })

  it('refuse a value that a keyframed Number changes while playing', () => {
    const project = deck(
      [
        op('/spin', 'NumberOp', { val: 0 }),
        op('/xy', 'CombineXYOp'),
        op('/split', 'SplitXYOp'),
        op('/camera', 'MapViewStateOp'),
      ],
      [
        wire('/spin', 'val', '/xy', 'x'),
        wire('/xy', 'xy', '/split', 'vec'),
        wire('/split', 'x', '/camera', 'bearing'),
        wire('/camera', 'viewState', '/deck', 'viewState'),
      ],
      { sheetsById: { main: { sequence: { tracksByObject: { '/spin': { trackData: {} } } } } } }
    )
    expect(() => toEditorDoc(project)).toThrow(MigrationError)
    expect(() => toEditorDoc(project)).toThrow(/bearing from SplitXYOp changes while playing/)
  })

  it('makes curves scalar operators a Number drives, as Bezier Curve and Ramp computed them', () => {
    const { doc } = toEditorDoc(
      deck(
        [
          op('/t', 'NumberOp', { val: 0.25 }),
          op('/ease', 'RampOp', {
            stops: [
              { pos: 0, val: 0, interp: 'linear' },
              { pos: 1, val: 20, interp: 'linear' },
            ],
          }),
          op('/camera', 'MapViewStateOp'),
        ],
        [
          wire('/t', 'val', '/ease', 'position'),
          wire('/ease', 'value', '/camera', 'zoom'),
          wire('/camera', 'viewState', '/deck', 'viewState'),
        ]
      )
    )
    expect(doc.nodes.find(n => n.id === '/ease')?.op).toBe('ramp')
    expect(doc.edges).toContainEqual(
      expect.objectContaining({ source: '/t', target: '/ease', targetPort: 'par:position' })
    )
    expect(doc.edges).toContainEqual(
      expect.objectContaining({
        source: '/ease',
        sourcePort: 'out',
        target: '/camera',
        targetPort: 'par:zoom',
      })
    )
    const at = (type: string, values: Record<string, number | string>) =>
      VALUE_OPS.find(o => o.type === type)!.scalar!(
        { num: k => Number(values[k]), str: k => String(values[k] ?? '') },
        { T: 0, F: 0 }
      )
    expect(
      at('ramp', {
        position: 0.25,
        stops: String(doc.nodes.find(n => n.id === '/ease')?.params.stops),
      })
    ).toBe(5)
    expect(at('ramp', { position: 0.5, stops: '' })).toBeCloseTo(0.5)
    expect(
      at('bezier-curve', { factor: 1, curve: '{"points":[{"x":0,"y":0},{"x":1,"y":1}]}' })
    ).toBe(1)
  })
})
