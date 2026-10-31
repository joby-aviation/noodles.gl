import type { EditorDoc } from '@noodles.gl/planner'
import { describe, expect, it } from 'vitest'
import { DocStore } from '../../editor/doc-store'
import { opView } from '../../editor/op-view'
import { getKeysStore, useKeysStore } from '../../noodles/keys-store'
import { setOpResolver } from '../../noodles/op-resolver'
import { isHostOperator, registerHostOperators } from './host-ops'
import { HostRunner } from './host-runner'

const doc = (opacity: number, wired = false): EditorDoc => ({
  version: 1,
  name: 'host',
  nodes: [
    { id: '/level', op: 'number', x: 0, y: 0, params: { value: 0.25 } },
    {
      id: '/bitmap',
      op: 'bitmap',
      x: 0,
      y: 0,
      params: {
        image: 'https://example.com/a.png',
        opacity,
        bounds: [
          [0, 0],
          [1, 1],
        ],
      },
    },
  ],
  edges: wired
    ? [
        {
          id: 'e1',
          source: '/level',
          sourcePort: 'out',
          target: '/bitmap',
          targetPort: 'par:opacity',
        },
      ]
    : [],
})

const inputs = (slots: Record<string, unknown> = {}) => ({
  planner: () => undefined,
  slots: new Map(Object.entries(slots)),
  time: 0,
})

describe('host operators', () => {
  it('registers operators without accessor inputs, and never accessor layers', () => {
    const types = registerHostOperators()
    expect(types).toContain('CodeOp')
    // A layer without rows is a deck operator now, not a Noodles class
    expect(types).not.toContain('BitmapLayerOp')
    expect(types).not.toContain('AccessorOp')
    expect(types).not.toContain('GeoJsonLayerOp')
    expect(types).not.toContain('ScatterplotLayerOp')
    expect(isHostOperator('GeoJsonLayerOp')).toBe(false)
  })
})

describe('HostRunner', () => {
  it('runs an operator, reuses an unchanged run, and re-runs when a parameter changes', async () => {
    const runner = new HostRunner()
    const first = await runner.run(doc(0.5), inputs())
    expect(first).toMatchObject({ ran: ['/bitmap'], errors: [] })
    const layer = runner.output('/bitmap', 'layer') as Record<string, unknown>
    expect(layer).toMatchObject({ type: 'BitmapLayer', id: '/bitmap', opacity: 0.5 })

    const again = await runner.run(doc(0.5), inputs())
    expect(again.reused).toEqual(['/bitmap'])
    expect(runner.output('/bitmap', 'layer')).toBe(layer)

    await runner.run(doc(0.8), inputs())
    expect(runner.output('/bitmap', 'layer')).toMatchObject({ opacity: 0.8 })
  })

  it('reads a wired parameter from the scalar program', async () => {
    const runner = new HostRunner()
    await runner.run(doc(1, true), inputs({ '/level.out': 0.25 }))
    expect(runner.output('/bitmap', 'layer')).toMatchObject({ opacity: 0.25 })
  })

  it('reads a keyframed parameter at the playhead from the scalar program', async () => {
    const runner = new HostRunner()
    const keyed: EditorDoc = {
      ...doc(1),
      timeline: {
        length: 2,
        fps: 30,
        tracks: [
          {
            target: '/bitmap.opacity',
            keyframes: [
              { id: 'a', time: 0, value: 0, interpolation: 'linear' },
              { id: 'b', time: 2, value: 1, interpolation: 'linear' },
            ],
          },
        ],
      },
    }
    await runner.run(keyed, inputs({ '/bitmap.opacity': 0.5 }))
    expect(runner.output('/bitmap', 'layer')).toMatchObject({ opacity: 0.5 })
  })

  it("resolves op() in a CodeOp's code against the document", async () => {
    const code: EditorDoc = {
      ...doc(1),
      nodes: [
        ...doc(1).nodes,
        {
          id: '/code',
          op: 'CodeOp',
          x: 0,
          y: 0,
          params: { code: "return [op('/level').par.value * 4]" },
        },
      ],
    }
    const store = new DocStore(code)
    setOpResolver((path, contextId) => opView(store, () => undefined, path, contextId))
    try {
      const runner = new HostRunner()
      await runner.run(code, inputs())
      expect(runner.output('/code', 'data')).toEqual([1])
    } finally {
      setOpResolver(undefined)
    }
  })

  it('reports a failing operator instead of throwing', async () => {
    const runner = new HostRunner()
    const bad: EditorDoc = {
      ...doc(1),
      nodes: [
        { id: '/code', op: 'CodeOp', x: 0, y: 0, params: { code: 'throw new Error("boom")' } },
      ],
    }
    const report = await runner.run(bad, inputs())
    expect(report.errors).toEqual([{ nodeId: '/code', message: expect.stringContaining('boom') }])
  })
})

describe('deck operators', () => {
  it('build views from a wired view state, and layers with their extensions in order', async () => {
    const deck: EditorDoc = {
      version: 1,
      name: 'deck',
      nodes: [
        { id: '/camera', op: 'view-state', x: 0, y: 0, params: { longitude: 2, latitude: 3 } },
        { id: '/view', op: 'map-view', x: 0, y: 0, params: { fovy: 30 } },
        { id: '/bright', op: 'brightness-contrast', x: 0, y: 0, params: { brightness: 0.5 } },
        { id: '/vivid', op: 'vibrance', x: 0, y: 0, params: { amount: 0.2 } },
        ...doc(1).nodes,
      ],
      edges: [
        {
          id: 'a',
          source: '/camera',
          sourcePort: 'viewState',
          target: '/view',
          targetPort: 'par:viewState',
        },
        {
          id: 'b',
          source: '/bright',
          sourcePort: 'extension',
          target: '/bitmap',
          targetPort: 'par:extensions',
          index: 0,
        },
        {
          id: 'c',
          source: '/vivid',
          sourcePort: 'extension',
          target: '/bitmap',
          targetPort: 'par:extensions',
          index: 1,
        },
      ],
    }
    const runner = new HostRunner()
    const report = await runner.run(deck, inputs())
    expect(report.errors).toEqual([])
    expect(runner.output('/view', 'view')).toMatchObject({
      type: 'MapView',
      id: '/view',
      fovy: 30,
      viewState: { longitude: 2, latitude: 3, zoom: 12, maxPitch: 90 },
    })
    expect(runner.output('/bitmap', 'layer')).toMatchObject({
      type: 'BitmapLayer',
      bounds: [0, 0, 1, 1],
      extensions: [{ type: 'BrightnessContrastExtension' }, { type: 'VibranceExtension' }],
      brightnessContrast: { brightness: 0.5, contrast: 0 },
      vibrance: { amount: 0.2 },
    })
  })

  it('build a Tile 3D layer again when the key it loads with changes', async () => {
    const tiles: EditorDoc = {
      version: 1,
      name: 'tiles',
      nodes: [{ id: '/tiles', op: 'tile-3d', x: 0, y: 0, params: { provider: 'Google' } }],
      edges: [],
    }
    useKeysStore.setState({ browserKeys: {}, keyOverrides: {}, projectKeys: undefined })
    try {
      getKeysStore().setBrowserKey('googleMaps', 'g.one')
      const runner = new HostRunner()
      expect((await runner.run(tiles, inputs())).ran).toEqual(['/tiles'])
      expect((await runner.run(tiles, inputs())).reused).toEqual(['/tiles'])
      getKeysStore().setBrowserKey('googleMaps', 'g.two')
      expect((await runner.run(tiles, inputs())).ran).toEqual(['/tiles'])
      expect(runner.output('/tiles', 'layer')).toMatchObject({
        loadOptions: { fetch: { headers: { 'X-GOOG-API-KEY': 'g.two' } } },
      })
    } finally {
      useKeysStore.setState({ browserKeys: {} })
    }
  })

  it('build a legend from a color scheme by name', async () => {
    const legend: EditorDoc = {
      version: 1,
      name: 'legend',
      nodes: [
        {
          id: '/legend',
          op: 'legend-widget',
          x: 0,
          y: 0,
          params: { colorScheme: 'magma', steps: 3 },
        },
      ],
      edges: [],
    }
    const runner = new HostRunner()
    await runner.run(legend, inputs())
    const widget = runner.output('/legend', 'widget') as { colorStops: string[] }
    expect(widget).toMatchObject({ type: 'LegendWidget', placement: 'bottom-right' })
    expect(widget.colorStops).toHaveLength(3)
  })
})

describe('HostRunner and the timeline', () => {
  const code = (text: string): EditorDoc => ({
    version: 1,
    name: 'code',
    nodes: [{ id: '/code', op: 'CodeOp', x: 0, y: 0, params: { code: text } }],
    edges: [],
  })

  it('re-runs a CodeOp when the time moves only if its code reads the time', async () => {
    const runner = new HostRunner()
    await runner.run(code('return [1, 2]'), inputs())
    const later = await runner.run(code('return [1, 2]'), { ...inputs(), time: 2 })
    expect(later.reused).toEqual(['/code'])

    const timed = new HostRunner()
    await timed.run(code('return [frame]'), inputs())
    expect((await timed.run(code('return [frame]'), { ...inputs(), time: 2 })).ran).toEqual([
      '/code',
    ])
  })
})
