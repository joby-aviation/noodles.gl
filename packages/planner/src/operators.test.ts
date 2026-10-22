import { describe, it, expect } from 'vitest'
import { lowerDocument, parameterValues } from './lower.js'
import { OPERATOR_INDEX, canConnect, paramAccepts, registerOperator, registerRamp } from './operators.js'
import { buildRampLut, RAMP_STOPS } from './types.js'
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
