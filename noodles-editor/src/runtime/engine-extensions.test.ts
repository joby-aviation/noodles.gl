// Extensions wired into a planner layer reach the deck layer the engine builds.
import type { EditorDoc } from '@noodles.gl/planner'
import { describe, expect, it } from 'vitest'
import {
  instantiateExtensions,
  instantiateLayer,
  instantiateWidget,
} from '../noodles/utils/instantiate-vis'
import { DuckDbEngine } from './duckdb'
import { Engine } from './engine'
import { registerHostOperators } from './host/host-ops'
import { HostRunner } from './host/host-runner'

const doc: EditorDoc = {
  version: 1,
  name: 'extended',
  nodes: [
    { id: 'src', op: 'sql', x: 0, y: 0, params: { query: 'SELECT 1.0 AS x, 2.0 AS y' } },
    { id: 'dots', op: 'scatter', x: 0, y: 0, params: { position: '[x, y]' } },
    { id: 'bright', op: 'brightness-contrast', x: 0, y: 0, params: { brightness: 0.25 } },
    { id: 'map', op: 'deck', x: 0, y: 0, params: { basemap: 'none' } },
  ],
  edges: [
    { id: 'e1', source: 'src', sourcePort: 'out', target: 'dots', targetPort: 'in' },
    {
      id: 'e2',
      source: 'bright',
      sourcePort: 'extension',
      target: 'dots',
      targetPort: 'par:extensions',
    },
    { id: 'e3', source: 'dots', sourcePort: 'out', target: 'map', targetPort: 'layers' },
  ],
}

const open = (sql: DuckDbEngine) =>
  new Engine(sql, {
    host: {
      runner: new HostRunner(),
      layer: instantiateLayer,
      widget: instantiateWidget,
      view: v => v,
      extensions: values => {
        const list = values as { extension: unknown; props?: Record<string, unknown> }[]
        return {
          extensions: instantiateExtensions(list.map(v => v.extension)) ?? [],
          props: Object.assign({}, ...list.map(v => v.props ?? {})),
        }
      },
    },
  })

type DeckLayer = { id: string; props: Record<string, unknown> }

describe('Engine extensions', () => {
  it('attaches extensions to a planner layer, the same instances while nothing changes', async () => {
    registerHostOperators()
    const sql = await DuckDbEngine.open()
    const engine = new Engine(sql, {
      host: {
        runner: new HostRunner(),
        layer: instantiateLayer,
        widget: instantiateWidget,
        view: v => v,
        extensions: values => {
          const list = values as { extension: unknown; props?: Record<string, unknown> }[]
          return {
            extensions: instantiateExtensions(list.map(v => v.extension)) ?? [],
            props: Object.assign({}, ...list.map(v => v.props ?? {})),
          }
        },
      },
    })
    await engine.setDoc(doc, 0)
    await engine.settle()
    const [layer] = engine.vis().deckProps.layers as { props: Record<string, unknown> }[]
    const extensions = layer.props.extensions as unknown[]
    expect(extensions).toHaveLength(1)
    expect(layer.props.brightnessContrast).toEqual({ brightness: 0.25, contrast: 0 })
    // A second vis keeps the extension instances, so deck does not reset the layer
    const [again] = engine.vis().deckProps.layers as { props: Record<string, unknown> }[]
    expect((again.props.extensions as unknown[])[0]).toBe(extensions[0])
    await sql.close()
  })

  // #889: Layer Props reads the layer as the deck would draw it
  it('keeps a layer’s extensions through Layer Props', async () => {
    registerHostOperators()
    const sql = await DuckDbEngine.open()
    const engine = open(sql)
    const props: EditorDoc = {
      ...doc,
      nodes: [...doc.nodes, { id: 'props', op: 'layer-props', x: 0, y: 0, params: {} }],
      edges: [
        ...doc.edges.filter(e => e.id !== 'e3'),
        { id: 'e4', source: 'dots', sourcePort: 'out', target: 'props', targetPort: 'par:layer' },
        { id: 'e5', source: 'props', sourcePort: 'layer', target: 'map', targetPort: 'layers' },
      ],
    }
    await engine.setDoc(props, 0)
    await engine.settle()
    const layers = engine.vis().deckProps.layers as DeckLayer[]
    expect(layers.map(l => l.id)).toEqual(['dots:scatter'])
    expect(layers[0].props.extensions as unknown[]).toHaveLength(1)
    expect(layers[0].props.brightnessContrast).toEqual({ brightness: 0.25, contrast: 0 })
    await sql.close()
  })

  it('keeps every deck layer of a node through Layer Props: a polygon’s fill and outline', async () => {
    registerHostOperators()
    const sql = await DuckDbEngine.open()
    const engine = open(sql)
    const shapes: EditorDoc = {
      version: 1,
      name: 'outlined',
      nodes: [
        {
          id: 'src',
          op: 'sql',
          x: 0,
          y: 0,
          params: { query: "SELECT ST_GeomFromText('POLYGON((0 0, 1 0, 1 1, 0 0))') AS geom" },
        },
        { id: 'zone', op: 'polygon', x: 0, y: 0, params: { position: 'geom', stroked: true } },
        { id: 'props', op: 'layer-props', x: 0, y: 0, params: {} },
        { id: 'map', op: 'deck', x: 0, y: 0, params: { basemap: 'none' } },
      ],
      edges: [
        { id: 'e1', source: 'src', sourcePort: 'out', target: 'zone', targetPort: 'in' },
        { id: 'e2', source: 'zone', sourcePort: 'out', target: 'props', targetPort: 'par:layer' },
        { id: 'e3', source: 'props', sourcePort: 'layer', target: 'map', targetPort: 'layers' },
      ],
    }
    await engine.setDoc(shapes, 0)
    await engine.settle()
    const through = (engine.vis().deckProps.layers as DeckLayer[]).map(l => l.id)
    expect(through.length).toBeGreaterThan(1)
    expect(through).toContain('zone:outline')
    await sql.close()
  })

  // #887: a mask named by its node, as a user types it and older projects saved it
  it('resolves a Mask Extension’s maskId naming a node to that node’s deck layer', async () => {
    registerHostOperators()
    const sql = await DuckDbEngine.open()
    const engine = open(sql)
    const masked: EditorDoc = {
      version: 1,
      name: 'mask',
      nodes: [
        { id: 'src', op: 'sql', x: 0, y: 0, params: { query: 'SELECT 1.0 AS x, 2.0 AS y' } },
        { id: 'zone', op: 'scatter', x: 0, y: 0, params: { position: '[x, y]' } },
        { id: 'zone-mask', op: 'layer-props', x: 0, y: 0, params: { operation: 'mask' } },
        { id: 'dots', op: 'scatter', x: 0, y: 0, params: { position: '[x, y]' } },
        { id: 'mask-ext', op: 'mask-extension', x: 0, y: 0, params: { maskId: 'zone' } },
        { id: 'map', op: 'deck', x: 0, y: 0, params: { basemap: 'none' } },
      ],
      edges: [
        { id: 'e1', source: 'src', sourcePort: 'out', target: 'zone', targetPort: 'in' },
        { id: 'e2', source: 'src', sourcePort: 'out', target: 'dots', targetPort: 'in' },
        {
          id: 'e3',
          source: 'zone',
          sourcePort: 'out',
          target: 'zone-mask',
          targetPort: 'par:layer',
        },
        {
          id: 'e4',
          source: 'mask-ext',
          sourcePort: 'extension',
          target: 'dots',
          targetPort: 'par:extensions',
        },
        {
          id: 'e5',
          source: 'zone-mask',
          sourcePort: 'layer',
          target: 'map',
          targetPort: 'layers',
          index: 0,
        },
        {
          id: 'e6',
          source: 'dots',
          sourcePort: 'out',
          target: 'map',
          targetPort: 'layers',
          index: 1,
        },
      ],
    }
    await engine.setDoc(masked, 0)
    await engine.settle()
    const [mask, dots] = engine.vis().deckProps.layers as DeckLayer[]
    expect(mask.id).toBe('zone:scatter')
    expect(dots.props.maskId).toBe(mask.id)

    // A mask Layer Props gave its own id keeps it: that is the drawn id
    await engine.setDoc(
      {
        ...masked,
        nodes: masked.nodes.map(n =>
          n.id === 'zone-mask'
            ? { ...n, params: { operation: 'mask', additionalProps: '{"id": "zone"}' } }
            : n
        ),
      },
      0
    )
    await engine.settle()
    const [own, ownDots] = engine.vis().deckProps.layers as DeckLayer[]
    expect(own.id).toBe('zone')
    expect(ownDots.props.maskId).toBe('zone')

    // Through the Layer Props node, and a deck id typed as it is, alike
    for (const typed of ['zone-mask', 'zone:scatter']) {
      await engine.setDoc(
        {
          ...masked,
          nodes: masked.nodes.map(n =>
            n.id === 'mask-ext' ? { ...n, params: { maskId: typed } } : n
          ),
        },
        0
      )
      await engine.settle()
      const [, again] = engine.vis().deckProps.layers as DeckLayer[]
      expect(again.props.maskId, typed).toBe('zone:scatter')
    }
    await sql.close()
  })

  // #890: an object wired into Additional props, which JSON can't hold when it has functions
  it('adds the props wired into Layer Props', async () => {
    registerHostOperators()
    const sql = await DuckDbEngine.open()
    const engine = open(sql)
    const wired: EditorDoc = {
      version: 1,
      name: 'wired',
      nodes: [
        { id: 'src', op: 'sql', x: 0, y: 0, params: { query: 'SELECT 1.0 AS x, 2.0 AS y' } },
        { id: 'dots', op: 'scatter', x: 0, y: 0, params: { position: '[x, y]' } },
        {
          id: 'extra',
          op: 'CodeOp',
          x: 0,
          y: 0,
          params: { code: 'return { radiusScale: 150, onHover: () => true }' },
        },
        { id: 'props', op: 'layer-props', x: 0, y: 0, params: {} },
        { id: 'map', op: 'deck', x: 0, y: 0, params: { basemap: 'none' } },
      ],
      edges: [
        { id: 'e1', source: 'src', sourcePort: 'out', target: 'dots', targetPort: 'in' },
        { id: 'e2', source: 'dots', sourcePort: 'out', target: 'props', targetPort: 'par:layer' },
        {
          id: 'e3',
          source: 'extra',
          sourcePort: 'data',
          target: 'props',
          targetPort: 'par:additionalProps',
        },
        { id: 'e4', source: 'props', sourcePort: 'layer', target: 'map', targetPort: 'layers' },
      ],
    }
    await engine.setDoc(wired, 0)
    await engine.settle()
    const [layer] = engine.vis().deckProps.layers as DeckLayer[]
    expect(layer.props.radiusScale).toBe(150)
    expect(typeof layer.props.onHover).toBe('function')
    await sql.close()
  })
})
