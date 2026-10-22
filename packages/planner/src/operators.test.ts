import { describe, it, expect } from 'vitest'
import { lowerDocument, parameterValues } from './lower.js'
import { OPERATOR_INDEX, OPERATORS, canConnect, paramAccepts, registerOperator, registerRamp } from './operators.js'
import { buildRampLut, RAMP_STOPS } from './types.js'
import { plan } from './planner.js'
import { evaluateStage } from './cpu-stage.js'
import { targetCaps } from './target.js'
import type { EditorDoc } from './doc.js'
import type { DeckNode, LayerNode } from './types.js'

const scatterDoc = (
  params: Record<string, unknown> = {},
  extra: EditorDoc['nodes'] = []
): EditorDoc => ({
  version: 1,
  name: 'test',
  nodes: [
    { id: 'src', op: 'sql', x: 0, y: 0, params: { query: 'SELECT 1.0 AS x, 2.0 AS y' } },
    {
      id: 'dots',
      op: 'scatter',
      x: 0,
      y: 0,
      params: { position: '[x, y]', ...params } as EditorDoc['nodes'][0]['params'],
    },
    { id: 'map', op: 'deck', x: 0, y: 0, params: {} },
    ...extra,
  ],
  edges: [
    { id: 'e1', source: 'src', sourcePort: 'out', target: 'dots', targetPort: 'in' },
    { id: 'e2', source: 'dots', sourcePort: 'out', target: 'map', targetPort: 'layers' },
  ],
})

const layerOf = (doc: EditorDoc, id = 'dots') =>
  lowerDocument(doc).graph.nodes.find((n): n is LayerNode => n.id === id && n.type === 'layer')!

describe('registerRamp', () => {
  it('makes a ramp available to the LUT builder and every ramp menu', () => {
    registerRamp(
      'test-ramp',
      [
        [0, 0, 0],
        [1, 1, 1],
      ],
      'Test ramp'
    )
    expect(RAMP_STOPS['test-ramp']).toHaveLength(2)
    const lut = buildRampLut('test-ramp', 3)
    expect([...lut.slice(4, 7)].map(v => +v.toFixed(2))).toEqual([0.5, 0.5, 0.5])
    const menu = OPERATOR_INDEX.get('color-ramp')!.params.find(p => p.name === 'ramp')!
    expect(menu.options).toContainEqual({ value: 'test-ramp', label: 'Test ramp' })
    // Every layer's ramp menu shares the same list.
    const layerMenu = OPERATOR_INDEX.get('scatter')!.params.find(p => p.name === 'ramp')!
    expect(layerMenu.options).toContainEqual({ value: 'test-ramp', label: 'Test ramp' })
  })

  it('rejects a ramp with one stop, and an unknown ramp in the LUT builder', () => {
    expect(() => registerRamp('flat', [[0, 0, 0]])).toThrow(/two stops/)
    expect(() => buildRampLut('no-such-ramp')).toThrow(/Unknown color ramp/)
  })
})

describe('layer style parameters', () => {
  it('lowers blending to a layer prop, normal by default', () => {
    expect(layerOf(scatterDoc()).props?.blend).toBe('normal')
    expect(layerOf(scatterDoc({ blend: 'additive' })).props?.blend).toBe('additive')
  })

  it('lowers arc width units', () => {
    const doc: EditorDoc = {
      ...scatterDoc(),
      nodes: [
        { id: 'src', op: 'sql', x: 0, y: 0, params: { query: 'SELECT 1.0 AS a, 2.0 AS b' } },
        {
          id: 'arcs',
          op: 'arc',
          x: 0,
          y: 0,
          params: { source: '[a, b]', target: '[b, a]', widthUnits: 'meters' },
        },
        { id: 'map', op: 'deck', x: 0, y: 0, params: {} },
      ],
      edges: [
        { id: 'e1', source: 'src', sourcePort: 'out', target: 'arcs', targetPort: 'in' },
        { id: 'e2', source: 'arcs', sourcePort: 'out', target: 'map', targetPort: 'layers' },
      ],
    }
    expect(layerOf(doc, 'arcs').props?.widthUnits).toBe('meters')
  })

  it('reads a layer color from a shared Color node by reference', () => {
    const doc = scatterDoc({ fillColor: { ref: 'brand/color' } }, [
      { id: 'brand', op: 'color', x: 0, y: 0, params: { color: [10, 20, 30] } },
    ])
    const lowered = lowerDocument(doc)
    expect(lowered.errors).toEqual([])
    const { values } = parameterValues(lowered, { T: 0, F: 0 })
    const fill = layerOf(doc).props?.fillColor as string[]
    const names = fill.map(ref => ref.replace(/^\{\{|\}\}$/g, ''))
    expect(names.map(n => values[n])).toEqual([10, 20, 30])
  })
})

describe('deck', () => {
  it('uses a map style URL over the basemap menu when one is set', () => {
    const deckOf = (params: Record<string, string>) => {
      const doc = scatterDoc()
      doc.nodes[2].params = params
      return lowerDocument(doc).graph.nodes.find((n): n is DeckNode => n.type === 'deck')!
    }
    expect(deckOf({}).basemap).toBe('dark-matter')
    expect(deckOf({ mapStyle: 'https://example.com/style.json' }).basemap).toBe(
      'https://example.com/style.json'
    )
  })
})

describe('host operators', () => {
  it('registers an operator lowering skips, and drops its layer from the deck', () => {
    registerOperator({
      type: 'HostLayerOp', label: 'Host layer', category: 'host', description: 'test',
      inputs: [], outputs: [{ name: 'layer', type: 'layer' }],
      params: [{ name: 'image', label: 'Image', kind: 'field', default: '', port: true, portType: 'value' }],
    });
    expect(OPERATOR_INDEX.get('HostLayerOp')?.category).toBe('host');
    const doc = scatterDoc({}, [{ id: 'bitmap', op: 'HostLayerOp', x: 0, y: 0, params: { image: '@/a.png' } }]);
    doc.edges.push({ id: 'e3', source: 'bitmap', sourcePort: 'layer', target: 'map', targetPort: 'layers', index: 1 });
    const lowered = lowerDocument(doc);
    expect(lowered.errors).toEqual([]);
    const deck = lowered.graph.nodes.find((n): n is DeckNode => n.type === 'deck')!;
    expect(deck.inputs).toEqual(['dots']);
  });

  it('lets value ports take anything, and a value feed a layer port', () => {
    expect(canConnect('table', 'value')).toBe(true);
    expect(canConnect('layer', 'value')).toBe(true);
    expect(canConnect('value', 'layer')).toBe(true);
    expect(canConnect('value', 'table')).toBe(false);
    expect(paramAccepts({ name: 'x', label: 'x', kind: 'float', default: 0 })).toBe('number');
  });

  it('gives the deck pass-through ports for views, effects, widgets and MapLibre layers', () => {
    const ports = OPERATOR_INDEX.get('deck')!.inputs.map((p) => `${p.name}:${p.type}`);
    expect(ports).toEqual([
      'layers:layer', 'views:value', 'effects:value', 'widgets:value', 'viewState:value', 'maplibreLayers:value',
    ]);
  });
});

describe('extent', () => {
  it('binds a wired min or max as a SQL statistic of the same layer', () => {
    const doc = scatterDoc({ radius: 'r' }, [
      { id: '/range', op: 'extent', x: 0, y: 0, params: { input: 'coalesce(y, 0.0)' } },
      { id: 'size', op: 'map-range', x: 0, y: 0, params: { input: 'y', name: 'r', inMin: 0, outMin: 0, outMax: 10 } },
    ])
    doc.edges = [
      { id: 'e1', source: 'src', sourcePort: 'out', target: 'size', targetPort: 'in' },
      { id: 'e2', source: 'src', sourcePort: 'out', target: '/range', targetPort: 'in' },
      { id: 'e3', source: '/range', sourcePort: 'max', target: 'size', targetPort: 'par:inMax' },
      { id: 'e4', source: 'size', sourcePort: 'out', target: 'dots', targetPort: 'in' },
      { id: 'e5', source: 'dots', sourcePort: 'out', target: 'map', targetPort: 'layers' },
    ]
    const lowered = lowerDocument(doc)
    expect(lowered.errors).toEqual([])
    const stats = lowered.graph.nodes.find((n) => n.type === 'stats')
    expect(stats).toMatchObject({ id: '_range', column: 'coalesce(y, 0.0)', ops: ['min', 'max'] })
    const scale = lowered.graph.nodes.find((n) => n.id === 'size') as { domain: string[] }
    expect(scale.domain[1]).toBe('{{_range_max}}')
    // No scalar parameter stands in for the statistic.
    expect(Object.keys(lowered.graph.params ?? {}).some((k) => k.includes('inMax'))).toBe(false)
  })
})

describe('predicate pushdown', () => {
  it('moves a SQL-only filter ahead of CPU-only attributes it does not read', () => {
    const graph = {
      params: {},
      nodes: [
        { id: 'src', type: 'source' as const, dataset: { ref: 't' } },
        { id: 'c', type: 'attribute' as const, input: 'src', name: 'Cd', expr: 'ramp(v / 10.0)' },
        { id: 'only', type: 'filter' as const, input: 'c', predicate: "kind == 'polygon'" },
        { id: 'l', type: 'layer' as const, kind: 'scatter' as const, input: 'only', channels: { position: 'P0' } },
        { id: 'p', type: 'attribute' as const, input: 'src', name: 'P0', expr: '[x, y]' },
      ],
      output: 'l',
    }
    graph.nodes[3] = { ...graph.nodes[3], input: 'only' }
    graph.nodes[1] = { ...graph.nodes[1], input: 'p' }
    const schema = new Map([['v', 1], ['x', 1], ['y', 1], ['kind', 1]])
    const physical = plan(graph as never, schema, {
      policy: 'auto', relation: '"t"', columnTypes: new Map([['kind', 'str']]),
      caps: targetCaps('deck-webgl2', undefined),
    })
    expect(physical.sql).toContain("WHERE")
    expect(physical.sql).toContain("'polygon'")
    expect(physical.notes.some((n) => n.includes('predicate pushdown'))).toBe(true)
  })

  it('keeps a filter behind the attribute it reads', () => {
    const graph = {
      params: {},
      nodes: [
        { id: 'src', type: 'source' as const, dataset: { ref: 't' } },
        { id: 'a', type: 'attribute' as const, input: 'src', name: 'big', expr: 'v * 2.0' },
        { id: 'f', type: 'filter' as const, input: 'a', predicate: 'big > 3.0' },
        { id: 'l', type: 'layer' as const, kind: 'scatter' as const, input: 'f', channels: { position: 'P0' } },
      ],
      output: 'l',
    }
    graph.nodes.splice(1, 0, { id: 'p', type: 'attribute' as const, input: 'src', name: 'P0', expr: '[v, v]' } as never)
    graph.nodes[2] = { ...graph.nodes[2], input: 'p' } as never
    const physical = plan(graph as never, new Map([['v', 1]]), {
      policy: 'auto', relation: '"t"', caps: targetCaps('deck-webgl2', undefined),
    })
    expect(physical.notes.some((n) => n.includes('predicate pushdown: f'))).toBe(false)
  })
})

describe('switch', () => {
  const twoLayers = (index: number): EditorDoc => ({
    version: 1,
    name: 'switch',
    nodes: [
      { id: 'src', op: 'sql', x: 0, y: 0, params: { query: 'SELECT 1.0 AS x, 2.0 AS y' } },
      { id: 'dots', op: 'scatter', x: 0, y: 0, params: { position: '[x, y]' } },
      { id: 'bins', op: 'hexagon', x: 0, y: 0, params: { position: '[x, y]', radius: 200 } },
      { id: 'pick', op: 'switch', x: 0, y: 0, params: { index } },
      { id: 'map', op: 'deck', x: 0, y: 0, params: {} },
    ],
    edges: [
      { id: 'e1', source: 'src', sourcePort: 'out', target: 'dots', targetPort: 'in' },
      { id: 'e2', source: 'src', sourcePort: 'out', target: 'bins', targetPort: 'in' },
      { id: 'e3', source: 'dots', sourcePort: 'out', target: 'pick', targetPort: 'in', index: 0 },
      { id: 'e4', source: 'bins', sourcePort: 'out', target: 'pick', targetPort: 'in', index: 1 },
      { id: 'e5', source: 'pick', sourcePort: 'out', target: 'map', targetPort: 'layers' },
    ],
  })

  it('passes the chosen layer to the deck, clamping the index', () => {
    const deckInputs = (index: number) =>
      lowerDocument(twoLayers(index)).graph.nodes.find((n): n is DeckNode => n.type === 'deck')!.inputs
    expect(deckInputs(0)).toEqual(['dots'])
    expect(deckInputs(1)).toEqual(['bins'])
    expect(deckInputs(7)).toEqual(['bins'])
    const lowered = lowerDocument(twoLayers(1))
    expect(lowered.outputs.pick.out).toBe('bins')
    const bins = lowered.graph.nodes.find((n): n is LayerNode => n.id === 'bins')!
    expect(bins.kind).toBe('hexagon')
    expect(bins.props?.radius).toMatch(/^\{\{.*\}\}$/)
  })
})

describe('the catalog', () => {
  it('has one operator per type, so none silently replaces another', () => {
    const types = OPERATORS.map((o) => o.type)
    expect(types.filter((t, i) => types.indexOf(t) !== i)).toEqual([])
  })
})

describe('host values as parameters', () => {
  it('reads a ch() reference to a host operator output from the host values', () => {
    const doc: EditorDoc = {
      version: 1,
      name: 'host',
      nodes: [
        { id: 'geo', op: 'GeocoderOp', x: 0, y: 0, params: {} },
        { id: 'q', op: 'sql', x: 0, y: 0, params: { query: { expr: "SELECT ch('geo/out.location.lat') AS lat" } } },
        { id: 'dots', op: 'scatter', x: 0, y: 0, params: { position: '[lat, lat]' } },
        { id: 'map', op: 'deck', x: 0, y: 0, params: {} },
      ],
      edges: [
        { id: 'e1', source: 'q', sourcePort: 'out', target: 'dots', targetPort: 'in' },
        { id: 'e2', source: 'dots', sourcePort: 'out', target: 'map', targetPort: 'layers' },
      ],
    }
    const lowered = lowerDocument(doc)
    expect(lowered.errors).toEqual([])
    const [name] = lowered.slotParams['geo.out.location.lat']
    const host = new Map([['geo.out.location.lat', 39.74]])
    expect(parameterValues(lowered, { T: 0, F: 0 }, host).values[name]).toBe(39.74)
  })
})

describe('the auto policy', () => {
  it('falls back to a legal plan when its rules put CPU work ahead of SQL-only work', () => {
    const graph = {
      params: {},
      nodes: [
        { id: 'src', type: 'source' as const, dataset: { ref: 't' } },
        { id: 'c', type: 'attribute' as const, input: 'src', name: 'c', expr: '[sqrt(v), 140.0, 0.0]' },
        { id: 'o', type: 'attribute' as const, input: 'c', name: 'o', expr: '[0.0, random() * 180.0, 0.0]' },
        { id: 'l', type: 'layer' as const, kind: 'scatter' as const, input: 'o', channels: { position: 'c' } },
      ],
      output: 'l',
    }
    const physical = plan(graph as never, new Map([['v', 1]]), {
      policy: 'auto', relation: '"t"', caps: targetCaps('deck-webgl2', undefined),
    })
    expect(physical.assignments.find((a) => a.nodeId === 'o')?.engine).toBe('sql')
    expect(physical.notes.some((n) => n.includes('cheapest legal plan'))).toBe(true)
  })
})

describe('vectors from SQL on the CPU', () => {
  it('reads each component of a vector attribute SQL produced', () => {
    const graph = {
      params: {},
      nodes: [
        { id: 'src', type: 'source' as const, dataset: { ref: 't' } },
        { id: 'p', type: 'attribute' as const, input: 'src', name: 'P', expr: '[item(xy, 0.0), item(xy, 1.0)]' },
        // random() is SQL-only, which keeps c in SQL.
        { id: 'c', type: 'attribute' as const, input: 'p', name: 'c', expr: '[v, 140.0, random() * 0.0]' },
        { id: 'k', type: 'attribute' as const, input: 'c', name: 'k', expr: 'c / 255.0' },
        { id: 'l', type: 'layer' as const, kind: 'scatter' as const, input: 'k', channels: { position: 'P', color: 'k' } },
      ],
      output: 'l',
    }
    const physical = plan(graph as never, new Map([['v', 1]]), {
      policy: 'auto', relation: '"t"', caps: targetCaps('deck-webgl2', undefined),
      columnTypes: new Map([['v', 'num'], ['xy', 'other']]),
    })
    // `c / 255.0` reads a vector: not SQL, so the CPU computes it from c's three components.
    expect(physical.assignments.find((a) => a.nodeId === 'c')?.engine).toBe('sql')
    expect(physical.assignments.find((a) => a.nodeId === 'k')?.engine).toBe('cpu')
    const upload = (values: number[]) => ({
      tier: 'cast' as const, data: new Float32Array(values), chunkCount: 1, nullCount: 0, convertMs: 0, arrowType: 'Float', rows: 1,
    })
    const out = evaluateStage(physical.cpuStage, physical, new Map([['c', upload([51, 140, 0])], ['P', upload([1, 2])]]), {}, 1)
    expect([...(out.values.get('k')?.data ?? [])].map((x) => Math.round(x * 255))).toEqual([51, 140, 0])
  })
})
