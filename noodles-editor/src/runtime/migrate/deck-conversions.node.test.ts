// Views, widgets, extensions, tile layers and values: what a deck draws without rows.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { lowerDocument } from '@noodles.gl/planner'
import { beforeAll, describe, expect, it } from 'vitest'
import { registerDeckOperators } from '../deck-ops'
import { VALUE_OPS } from '../value-ops'
import {
  CONVERTED_SCHEMA,
  MigrationError,
  type NoodlesEdge,
  type NoodlesNode,
  type NoodlesProject,
  toEditorDoc,
} from './to-editor-doc'

beforeAll(() => registerDeckOperators())

const example = (name: string) =>
  JSON.parse(
    readFileSync(resolve(`src/runtime/migrate/__fixtures__/${name}.json`), 'utf8')
  ) as NoodlesProject
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
  version: CONVERTED_SCHEMA,
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
    // BoundingBox is a camera fit: its extent in DuckDB, the fit on the render surface
    expect(chargers.nodes.find(n => n.id === '/charger-bounds')).toMatchObject({
      op: 'fit-bounds',
      params: { padding: 200 },
    })
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

  it('converts a SwitchOp choosing the camera to a Switch Value of View States', () => {
    const { doc } = toEditorDoc(
      deck(
        [
          op('/sf', 'MapViewStateOp', { longitude: -122.4, latitude: 37.8, zoom: 10 }),
          op('/ny', 'MapViewStateOp', { longitude: -74, latitude: 40.7, zoom: 11 }),
          op('/shots', 'SwitchOp', { index: 1, blend: true }),
        ],
        [
          wire('/sf', 'viewState', '/shots', 'values'),
          wire('/ny', 'viewState', '/shots', 'values'),
          wire('/shots', 'value', '/deck', 'viewState'),
        ]
      )
    )
    const shots = doc.nodes.find(n => n.id === '/shots')
    expect(shots).toMatchObject({ op: 'switch-value', params: { index: 1, blend: true } })
    const into = (target: string, port: string) =>
      doc.edges
        .filter(e => e.target === target && e.targetPort === port)
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        .map(e => e.source)
    expect(into('/shots', 'par:values')).toEqual(['/sf', '/ny'])
    expect(into(doc.nodes.find(n => n.op === 'deck')?.id ?? '', 'viewState')).toEqual(['/shots'])
  })

  it('converts a switch between tables into the planner’s Switch, in wiring order', () => {
    const { doc, warnings } = toEditorDoc(
      deck(
        [
          op('/small', 'DuckDbOp', { query: 'SELECT 1.0 AS lng, 2.0 AS lat' }),
          op('/big', 'DuckDbOp', { query: 'SELECT 3.0 AS lng, 4.0 AS lat' }),
          op('/pick', 'SwitchOp', { index: 1 }),
          op('/where', 'AccessorOp', { expression: '[d.lng, d.lat]' }),
          op('/points', 'ScatterplotLayerOp'),
        ],
        [
          wire('/small', 'data', '/pick', 'values'),
          wire('/big', 'data', '/pick', 'values'),
          wire('/pick', 'value', '/points', 'data'),
          wire('/where', 'accessor', '/points', 'getPosition'),
          wire('/points', 'layer', '/deck', 'layers'),
        ]
      )
    )
    expect(doc.nodes.find(n => n.id === '/pick')).toMatchObject({
      op: 'switch',
      params: { index: 1 },
    })
    const into = doc.edges.filter(e => e.target === '/pick').map(e => [e.source, e.index])
    expect(into).toEqual([
      ['/small', 0],
      ['/big', 1],
    ])
    const lowered = lowerDocument(doc)
    expect(lowered.errors).toEqual([])
    expect(lowered.outputs['/pick'].out).toBe('/big')
    expect(warnings).toEqual([])
  })

  it('converts a camera SwitchOp feeding another as two Switch Values', () => {
    const { doc } = toEditorDoc(
      deck(
        [
          op('/a', 'MapViewStateOp', { zoom: 3 }),
          op('/b', 'MapViewStateOp', { zoom: 6 }),
          op('/c', 'MapViewStateOp', { zoom: 9 }),
          op('/inner', 'SwitchOp', { index: 1 }),
          op('/outer', 'SwitchOp', { index: 0 }),
        ],
        [
          wire('/a', 'viewState', '/inner', 'values'),
          wire('/b', 'viewState', '/inner', 'values'),
          wire('/inner', 'value', '/outer', 'values'),
          wire('/c', 'viewState', '/outer', 'values'),
          wire('/outer', 'value', '/deck', 'viewState'),
        ]
      )
    )
    expect(doc.nodes.filter(n => n.id === '/inner' || n.id === '/outer').map(n => n.op)).toEqual([
      'switch-value',
      'switch-value',
    ])
    const into = (target: string) =>
      doc.edges
        .filter(e => e.target === target && e.targetPort === 'par:values')
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        .map(e => e.source)
    expect(into('/inner')).toEqual(['/a', '/b'])
    expect(into('/outer')).toEqual(['/inner', '/c'])
  })

  it('make an opaque color from RGBA channels, each clamped to a whole 0 to 255', () => {
    const color = (inputs: Record<string, unknown>) =>
      toEditorDoc(
        deck(
          [op('/rgba', 'CombineRGBAOp', inputs), op('/bg', 'OrthographicViewOp')],
          [wire('/rgba', 'color', '/bg', 'clearColor'), wire('/bg', 'view', '/deck', 'views')]
        )
      ).doc.nodes.find(n => n.id === '/bg')?.params.clearColor
    // Alpha left alone is opaque, not 1 of 255
    expect(color({ r: 255, g: 128, b: 0 })).toBe('#ff8000ff')
    expect(color({ r: 300, g: 127.6, b: -4, a: 128 })).toBe('#ff800080')
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

describe('the small Noodles values, as planner and deck operators', () => {
  const quakes = op('/quakes', 'FileOp', { url: '@/quakes.geojson', format: 'json' })

  it('converts BoundingBox into a camera fit of a GeoJSON file, by its geometry', () => {
    const { doc } = toEditorDoc(
      deck(
        [quakes, op('/fit', 'BoundingBoxOp', { padding: 20 }), op('/camera', 'MapViewStateOp')],
        [wire('/quakes', 'data', '/fit', 'data'), wire('/fit', 'viewState', '/deck', 'viewState')]
      )
    )
    expect(doc.nodes.find(n => n.id === '/fit')).toMatchObject({
      op: 'fit-bounds',
      params: { padding: 20, position: 'geom' },
    })
    expect(doc.nodes.find(n => n.id === '/quakes')?.op).toBe('geojson')
    expect(doc.edges).toContainEqual(
      expect.objectContaining({ source: '/quakes', sourcePort: 'features', target: '/fit' })
    )
    expect(doc.edges).toContainEqual(
      expect.objectContaining({ source: '/fit', target: '/deck', targetPort: 'viewState' })
    )
  })

  it('converts Merge into a merge of the same objects, in order', () => {
    const { doc } = toEditorDoc(
      deck(
        [
          op('/a', 'MapViewStateOp', { zoom: 3 }),
          op('/b', 'MapViewStateOp', { pitch: 45 }),
          op('/both', 'MergeOp'),
        ],
        [
          wire('/a', 'viewState', '/both', 'objects'),
          wire('/b', 'viewState', '/both', 'objects'),
          wire('/both', 'object', '/deck', 'viewState'),
        ]
      )
    )
    expect(doc.nodes.find(n => n.id === '/both')?.op).toBe('merge')
    const into = doc.edges.filter(e => e.target === '/both').map(e => [e.source, e.index])
    expect(into).toEqual([
      ['/a', 0],
      ['/b', 1],
    ])
  })

  it('keeps a Number wired into a carried style input, and refuses any other wire', () => {
    const path = (wired: NoodlesNode, field: string) =>
      deck(
        [
          op('/rows', 'DuckDbOp', { query: 'SELECT [[0.0, 0.0], [1.0, 1.0]] AS path' }),
          op('/where', 'AccessorOp', { expression: 'd.path' }),
          wired,
          op('/lines', 'PathLayerOp', { jointRounded: false }),
        ],
        [
          wire('/rows', 'data', '/lines', 'data'),
          wire('/where', 'accessor', '/lines', 'getPath'),
          wire(wired.id, 'val', '/lines', field),
          wire('/lines', 'layer', '/deck', 'layers'),
        ]
      )
    const { doc } = toEditorDoc(path(op('/miter', 'NumberOp', { val: 6 }), 'miterLimit'))
    expect(doc.edges).toContainEqual(
      expect.objectContaining({ source: '/miter', target: '/lines', targetPort: 'par:miterLimit' })
    )
    expect(() => toEditorDoc(path(op('/flag', 'NumberOp', { val: 1 }), 'billboard'))).toThrow(
      /a wired billboard is not converted/
    )
  })

  it('converts a scatterplot outline of one color and width, facing and antialiasing', () => {
    const { doc, warnings } = toEditorDoc(
      deck(
        [
          op('/rows', 'DuckDbOp', { query: 'SELECT 1.0 AS lng, 2.0 AS lat' }),
          op('/where', 'AccessorOp', { expression: '[d.lng, d.lat]' }),
          op('/points', 'ScatterplotLayerOp', {
            getLineWidth: 2,
            getLineColor: '#ff0000',
            billboard: true,
            antialiasing: false,
          }),
        ],
        [
          wire('/rows', 'data', '/points', 'data'),
          wire('/where', 'accessor', '/points', 'getPosition'),
          wire('/points', 'layer', '/deck', 'layers'),
        ]
      )
    )
    expect(doc.nodes.find(n => n.id === '/points')?.params).toMatchObject({
      stroked: true,
      lineWidthScale: 2,
      // deck's own unit, which Noodles never set
      lineWidthUnits: 'meters',
      lineColor: [255, 0, 0],
      billboard: true,
      antialiasing: false,
    })
    expect(warnings.filter(w => w.includes('dropped'))).toEqual([])
  })

  it('converts a per-row outline width and color into the outline channels', () => {
    const { doc, warnings } = toEditorDoc(
      deck(
        [
          op('/rows', 'DuckDbOp', { query: 'SELECT 1.0 AS lng, 2.0 AS lat' }),
          op('/where', 'AccessorOp', { expression: '[d.lng, d.lat]' }),
          op('/width', 'AccessorOp', { expression: 'd.lng * 3' }),
          op('/tint', 'AccessorOp', { expression: '[d.lng * 255, 0, 0]' }),
          op('/points', 'ScatterplotLayerOp', { getLineWidth: 1 }),
        ],
        [
          wire('/rows', 'data', '/points', 'data'),
          wire('/where', 'accessor', '/points', 'getPosition'),
          wire('/width', 'accessor', '/points', 'getLineWidth'),
          wire('/tint', 'accessor', '/points', 'getLineColor'),
          wire('/points', 'layer', '/deck', 'layers'),
        ]
      )
    )
    const params = doc.nodes.find(n => n.id === '/points')?.params
    expect(params).toMatchObject({ stroked: true, lineWidthScale: 1 })
    expect(params?.lineWidth).toEqual(expect.any(String))
    expect(params?.lineColorChannel).toEqual(expect.any(String))
    expect(warnings).toEqual([])
    expect(lowerDocument(doc).errors).toEqual([])
  })

  it('converts a per-row trail width, an arc tilt and a label border', () => {
    const { doc, warnings } = toEditorDoc(
      deck(
        [
          op('/rows', 'DuckDbOp', {
            query:
              'SELECT [[0.0, 0.0], [1.0, 1.0]] AS path, [0.0, 1.0] AS ts, 1.0 AS lng, 2.0 AS lat, 4.0 AS w',
          }),
          op('/path', 'AccessorOp', { expression: 'd.path' }),
          op('/times', 'AccessorOp', { expression: 'd.ts' }),
          op('/width', 'AccessorOp', { expression: 'd.w' }),
          op('/trips', 'TripsLayerOp', { widthScale: 2 }),
          op('/from', 'AccessorOp', { expression: '[d.lng, d.lat]' }),
          op('/arcs', 'ArcLayerOp', { getTilt: 30 }),
          op('/names', 'AccessorOp', { expression: 'd.lng' }),
          op('/labels', 'TextLayerOp', {
            background: true,
            getBorderWidth: 2,
            getBorderColor: '#00ff00ff',
          }),
        ],
        [
          wire('/rows', 'data', '/trips', 'data'),
          wire('/path', 'accessor', '/trips', 'getPath'),
          wire('/times', 'accessor', '/trips', 'getTimestamps'),
          wire('/width', 'accessor', '/trips', 'getWidth'),
          wire('/trips', 'layer', '/deck', 'layers'),
          wire('/rows', 'data', '/arcs', 'data'),
          wire('/from', 'accessor', '/arcs', 'getSourcePosition'),
          wire('/from', 'accessor', '/arcs', 'getTargetPosition'),
          wire('/arcs', 'layer', '/deck', 'layers'),
          wire('/rows', 'data', '/labels', 'data'),
          wire('/from', 'accessor', '/labels', 'getPosition'),
          wire('/names', 'accessor', '/labels', 'getText'),
          wire('/labels', 'layer', '/deck', 'layers'),
        ]
      )
    )
    const params = (id: string) => doc.nodes.find(n => n.id === id)?.params
    expect(params('/trips')).toMatchObject({ widthScale: 2 })
    expect(params('/trips')?.width).toEqual(expect.any(String))
    expect(params('/arcs')).toMatchObject({ tilt: 30 })
    expect(params('/labels')).toMatchObject({ borderWidth: 2, borderColor: [0, 255, 0] })
    expect(warnings.filter(w => w.includes('dropped'))).toEqual([])
  })

  it('converts a label border whose color was left at Noodles’ black', () => {
    const { doc } = toEditorDoc(
      deck(
        [
          op('/rows', 'DuckDbOp', { query: "SELECT 1.0 AS lng, 2.0 AS lat, 'a' AS name" }),
          op('/where', 'AccessorOp', { expression: '[d.lng, d.lat]' }),
          op('/names', 'AccessorOp', { expression: 'd.name' }),
          op('/labels', 'TextLayerOp', { background: true, getBorderWidth: 2 }),
        ],
        [
          wire('/rows', 'data', '/labels', 'data'),
          wire('/where', 'accessor', '/labels', 'getPosition'),
          wire('/names', 'accessor', '/labels', 'getText'),
          wire('/labels', 'layer', '/deck', 'layers'),
        ]
      )
    )
    expect(doc.nodes.find(n => n.id === '/labels')?.params).toMatchObject({
      borderWidth: 2,
      borderColor: [0, 0, 0],
    })
  })

  it('carries a hexagon layer’s scales, and leaves defaults out of the document', () => {
    const { doc } = toEditorDoc(
      deck(
        [
          op('/rows', 'DuckDbOp', { query: 'SELECT 1.0 AS lng, 2.0 AS lat' }),
          op('/where', 'AccessorOp', { expression: '[d.lng, d.lat]' }),
          op('/bins', 'HexagonLayerOp', {
            colorDomain: [0, 10],
            elevationRange: [0, 5000],
            colorScaleType: 'quantile',
            coverage: 1,
          }),
        ],
        [
          wire('/rows', 'data', '/bins', 'data'),
          wire('/where', 'accessor', '/bins', 'getPosition'),
          wire('/bins', 'layer', '/deck', 'layers'),
        ]
      )
    )
    const params = doc.nodes.find(n => n.id === '/bins')?.params
    expect(params).toMatchObject({
      colorDomain: '0, 10',
      elevationRange: '0, 5000',
      colorScaleType: 'quantile',
    })
    expect(params).not.toHaveProperty('coverage')
  })

  it('gives a path Noodles’ defaults where they differ from the planner’s', () => {
    const { doc } = toEditorDoc(
      deck(
        [
          op('/rows', 'DuckDbOp', { query: 'SELECT [[0.0, 0.0], [1.0, 1.0]] AS path' }),
          op('/where', 'AccessorOp', { expression: 'd.path' }),
          op('/lines', 'PathLayerOp'),
        ],
        [
          wire('/rows', 'data', '/lines', 'data'),
          wire('/where', 'accessor', '/lines', 'getPath'),
          wire('/lines', 'layer', '/deck', 'layers'),
        ]
      )
    )
    // Noodles' path faced the camera and had square joints
    expect(doc.nodes.find(n => n.id === '/lines')?.params).toMatchObject({
      billboard: true,
      jointRounded: false,
    })
  })

  it('converts LayerProps into props on the planner layer it wraps', () => {
    const { doc } = toEditorDoc(
      deck(
        [
          op('/rows', 'DuckDbOp', { query: 'SELECT 1.0 AS lng, 2.0 AS lat' }),
          op('/where', 'AccessorOp', { expression: '[d.lng, d.lat]' }),
          op('/points', 'ScatterplotLayerOp'),
          op('/mask', 'LayerPropsOp', { operation: 'mask' }),
        ],
        [
          wire('/rows', 'data', '/points', 'data'),
          wire('/where', 'accessor', '/points', 'getPosition'),
          wire('/points', 'layer', '/mask', 'layer'),
          wire('/mask', 'layer', '/deck', 'layers'),
        ]
      )
    )
    expect(doc.nodes.find(n => n.id === '/mask')).toMatchObject({
      op: 'layer-props',
      params: { operation: 'mask' },
    })
    expect(doc.nodes.find(n => n.id === '/points')?.op).toBe('scatter')
    expect(doc.edges).toContainEqual(
      expect.objectContaining({ source: '/points', target: '/mask', targetPort: 'par:layer' })
    )
    expect(doc.edges).toContainEqual(
      expect.objectContaining({ source: '/mask', sourcePort: 'layer', targetPort: 'layers' })
    )
    // The layer the props wrap is compiled though only the props node draws it
    const lowered = lowerDocument(doc)
    expect(lowered.errors).toEqual([])
    expect(lowered.graph.nodes.find(n => n.type === 'deck')).toMatchObject({
      inputs: ['/points'],
    })
  })

  it('converts a Mouse a query reads into a mouse node, and refuses a wired position', () => {
    const query = 'SELECT {{/pointer.out.position.x}} AS x'
    const { doc } = toEditorDoc(
      deck(
        [
          op('/pointer', 'MouseOp'),
          op('/rows', 'DuckDbOp', { query }),
          op('/where', 'AccessorOp', { expression: '[d.x, d.x]' }),
          op('/points', 'ScatterplotLayerOp'),
        ],
        [
          wire('/rows', 'data', '/points', 'data'),
          wire('/where', 'accessor', '/points', 'getPosition'),
          wire('/points', 'layer', '/deck', 'layers'),
        ]
      )
    )
    expect(doc.nodes.find(n => n.id === '/pointer')?.op).toBe('mouse')
    expect(String(doc.nodes.find(n => n.id === '/rows')?.params.query)).toContain(
      "ch('pointer/out.x')"
    )
    const wired = deck(
      [op('/pointer', 'MouseOp'), op('/camera', 'MapViewStateOp')],
      [
        wire('/pointer', 'position', '/camera', 'zoom'),
        wire('/camera', 'viewState', '/deck', 'viewState'),
      ]
    )
    expect(() => toEditorDoc(wired)).toThrow(/wired Mouse position is not converted/)
  })
})

describe('a file a host operator reads', () => {
  it('is the planner file node, whose rows the host operator reads', () => {
    const { doc } = toEditorDoc(
      deck(
        [
          op('/sales', 'FileOp', { url: '@/sales.csv', format: 'csv' }),
          // Code reading op() stays on the host
          op('/chart', 'CodeOp', { code: ['op("/sales"); return []'] }),
        ],
        [wire('/sales', 'data', '/chart', 'data'), wire('/chart', 'data', '/deck', 'layers')]
      )
    )
    expect(doc.nodes.find(n => n.id === '/sales')).toMatchObject({
      op: 'file',
      params: { url: '@/sales.csv', format: 'csv' },
    })
    expect(doc.edges).toContainEqual(
      expect.objectContaining({ source: '/sales', target: '/chart', targetPort: 'par:data' })
    )
    expect(doc.nodes.some(n => n.op === 'FileOp')).toBe(false)
  })
})

describe('a comment', () => {
  it('converts with its text and size, though nothing reaches it from the deck', () => {
    const note: NoodlesNode = {
      ...op('/note', 'CommentOp', { text: 'Explains the layer' }),
      position: { x: 40, y: 80 },
      width: 300,
      height: 90,
    }
    const { doc } = toEditorDoc(deck([note], []))
    expect(doc.nodes.find(n => n.id === '/note')).toMatchObject({
      op: 'comment',
      x: 40,
      y: 80,
      params: { text: 'Explains the layer', width: 300, height: 90 },
    })
    expect(lowerDocument(doc).errors).toEqual([])
  })
})
