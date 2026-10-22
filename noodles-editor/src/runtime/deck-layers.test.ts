// Planner layers drawn by a real deck on WebGL, from a program run against DuckDB-Wasm.
import { Deck, type Layer, MapView, OrthographicView } from '@deck.gl/core'
import { type EditorDoc, lowerDocument, parameterValues } from '@noodles.gl/planner'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { DeckLayerBuilder } from './deck-layers'
import { DuckDbEngine } from './duckdb'
import { ProgramRuntime } from './program-runtime'

const SIZE = 100

const doc: EditorDoc = {
  version: 1,
  name: 'one dot',
  nodes: [
    { id: 'src', op: 'sql', x: 0, y: 0, params: { query: 'SELECT 0.0 AS x, 0.0 AS y, 40.0 AS r' } },
    {
      id: 'dots',
      op: 'scatter',
      x: 0,
      y: 0,
      params: { position: '[x, y]', color: '[0.0, 0.0, 1.0]', radius: 'r', radiusScale: 1 },
    },
    { id: 'map', op: 'deck', x: 0, y: 0, params: {} },
  ],
  edges: [
    { id: 'e1', source: 'src', sourcePort: 'out', target: 'dots', targetPort: 'in' },
    { id: 'e2', source: 'dots', sourcePort: 'out', target: 'map', targetPort: 'layers' },
  ],
}

let deck: Deck<OrthographicView> | null = null
let canvas: HTMLCanvasElement | null = null

// Deck's render loop needs real requestAnimationFrame and timers
beforeAll(() => {
  vi.useRealTimers()
})
afterAll(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  deck?.finalize()
  canvas?.remove()
  deck = null
  canvas = null
})

async function draw(layers: Layer[]) {
  canvas = document.createElement('canvas')
  canvas.style.width = `${SIZE}px`
  canvas.style.height = `${SIZE}px`
  document.body.appendChild(canvas)
  const errors: Error[] = []
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Deck did not render')), 10000)
    deck = new Deck({
      canvas,
      width: SIZE,
      height: SIZE,
      useDevicePixels: false,
      views: new OrthographicView(),
      initialViewState: { target: [0, 0, 0], zoom: 0 },
      layers,
      onError: error => {
        errors.push(error)
      },
      onAfterRender: () => {
        if (layers.every(l => l.isLoaded) || errors.length) {
          clearTimeout(timeout)
          resolve()
        }
      },
    })
  })
  expect(errors).toEqual([])
  const read = document.createElement('canvas')
  read.width = SIZE
  read.height = SIZE
  const ctx = read.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Missing canvas')
  ctx.drawImage(canvas, 0, 0, SIZE, SIZE)
  return (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data)
}

describe('DeckLayerBuilder', () => {
  it('draws a planned scatter layer from binary attributes', async () => {
    const engine = await DuckDbEngine.open()
    const runtime = new ProgramRuntime(engine)
    const lowered = lowerDocument(doc)
    expect(lowered.errors).toEqual([])
    const values = parameterValues(lowered, { T: 0, F: 0 }).values
    await runtime.setGraph(lowered.graph, values)
    expect(runtime.program()?.errors).toEqual([])
    expect(runtime.layers().map(l => [l.id, l.error, l.data?.rows])).toEqual([
      ['dots', undefined, 1],
    ])

    const builder = new DeckLayerBuilder()
    const inputs = () =>
      runtime.layers().map(l => ({
        id: l.id,
        kind: l.plan.kind,
        data: l.data,
        bindings: l.plan.plan.layer?.bindings ?? [],
        props: l.props,
      }))
    const layers = builder.build(inputs()).get('dots') ?? []
    expect(layers).toHaveLength(1)
    const pixel = await draw(layers)
    // A 40px radius from the binary radius attribute covers the center and stops before the corner.
    expect(pixel(50, 50)).toEqual([0, 0, 255, 255])
    expect(pixel(70, 50)).toEqual([0, 0, 255, 255])
    expect(pixel(2, 2)[3]).toBe(0)

    // A prop change reuses the binary data object, so deck re-uploads nothing.
    await runtime.setValues({ ...values, dots__radiusScale: 2 })
    const next = builder.build(inputs()).get('dots') ?? []
    expect(builder.metrics().rebuilt).toBe(0)
    expect(next[0].props.data).toBe(layers[0].props.data)
    expect((next[0].props as unknown as Record<string, unknown>).radiusScale).toBe(2)
    await engine.close()
  })
})

describe('DeckLayerBuilder aggregation layers', () => {
  it('bins binary positions and weights into hexagons', async () => {
    const n = 50
    const position = new Float32Array(n * 2)
    for (let i = 0; i < n; i++) {
      position[i * 2] = -122.42 + (i % 5) * 0.002
      position[i * 2 + 1] = 37.77 + Math.floor(i / 5) * 0.002
    }
    const weight = new Float32Array(n).fill(2)
    const builder = new DeckLayerBuilder()
    const layers =
      builder
        .build([
          {
            id: 'bins',
            kind: 'hexagon',
            data: {
              rows: n,
              attributes: new Map([
                ['P', { data: position, width: 2 }],
                ['w', { data: weight, width: 1 }],
              ]),
              strings: new Map(),
              evalMs: 0,
              code: '',
            },
            bindings: [
              { channel: 'position', attribute: 'P' },
              { channel: 'colorWeight', attribute: 'w' },
            ],
            props: { radius: 200, extruded: false },
          },
        ])
        .get('bins') ?? []
    canvas = document.createElement('canvas')
    document.body.appendChild(canvas)
    const map = new Deck({
      canvas,
      width: SIZE,
      height: SIZE,
      views: new MapView(),
      initialViewState: { longitude: -122.416, latitude: 37.78, zoom: 13 },
      layers,
    })
    deck = map as unknown as Deck<OrthographicView>
    await new Promise(resolve => setTimeout(resolve, 1000))
    const manager = (map as unknown as { layerManager?: { getLayers(): Layer[] } }).layerManager
    const cells = manager?.getLayers().find(l => l.id.endsWith('-cells'))
    expect(cells?.getNumInstances()).toBeGreaterThan(0)
    // An aggregation that read nothing leaves deck's sentinel domain, [3e38, -3e38].
    const props = cells?.props as unknown as { colorDomain?: number[] } | undefined
    const domain = props?.colorDomain ?? [1, 0]
    expect(domain[0]).toBeLessThanOrEqual(domain[1])
    expect(domain[1]).toBeGreaterThan(0)
  })
})
