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

describe('DeckLayerBuilder mesh layers', () => {
  it('turns per-row orientation and scale into the instance model matrix deck reads', () => {
    const builder = new DeckLayerBuilder()
    const [layer] =
      builder
        .build([
          {
            id: 'meshes',
            kind: 'mesh',
            data: {
              rows: 2,
              attributes: new Map([
                ['P', { data: new Float32Array([0, 0, 0, 1, 1, 0]), width: 3 }],
                ['O', { data: new Float32Array([0, 0, 0, 0, 90, 0]), width: 3 }],
                ['S', { data: new Float32Array([1, 1, 1, 2, 2, 2]), width: 3 }],
              ]),
              strings: new Map(),
              evalMs: 0,
              code: '',
            },
            bindings: [
              { channel: 'position', attribute: 'P' },
              { channel: 'orientation', attribute: 'O' },
              { channel: 'scale', attribute: 'S' },
            ],
            props: {},
          },
        ])
        .get('meshes') ?? []
    const data = layer.props.data as unknown as {
      attributes: Record<string, { value: Float32Array; size: number }>
    }
    const matrix = data.attributes.instanceModelMatrix
    expect(matrix.size).toBe(12)
    expect([...matrix.value.slice(0, 9)].map(v => Math.round(v) || 0)).toEqual([
      1, 0, 0, 0, 1, 0, 0, 0, 1,
    ])
    // Yaw 90 degrees at scale 2: x maps to y and y to -x.
    expect([...matrix.value.slice(12, 21)].map(v => Math.round(v) || 0)).toEqual([
      0, 2, 0, -2, 0, 0, 0, 0, 2,
    ])
    expect(data.attributes.getOrientation).toBeUndefined()
  })
})

describe('DeckLayerBuilder other row layers', () => {
  const data = (
    rows: number,
    attributes: [string, Float32Array, number][],
    strings: [string, string[]][] = []
  ) => ({
    rows,
    attributes: new Map(attributes.map(([name, values, width]) => [name, { data: values, width }])),
    strings: new Map(strings),
    evalMs: 0,
    code: '',
  })
  const P = new Float32Array([-40, -40, 40, 40])

  // Six layer kinds compile their shaders on software WebGL, which takes CI past the default
  // 15 s
  it('draws lines, point clouds, square cells, text, screen grids and contours without errors', async () => {
    const builder = new DeckLayerBuilder()
    const built = builder.build([
      {
        id: 'lines',
        kind: 'line',
        data: data(1, [
          ['S', new Float32Array([-40, 0]), 2],
          ['T', new Float32Array([40, 0]), 2],
        ]),
        bindings: [
          { channel: 'sourcePosition', attribute: 'S' },
          { channel: 'targetPosition', attribute: 'T' },
        ],
        props: { widthScale: 4, color: [255, 0, 0] },
      },
      {
        id: 'cloud',
        kind: 'point-cloud',
        data: data(2, [['P', P, 2]]),
        bindings: [{ channel: 'position', attribute: 'P' }],
        props: { pointSize: 6, color: [0, 255, 0] },
      },
      {
        id: 'cells',
        kind: 'column',
        data: data(2, [['P', P, 2]]),
        bindings: [{ channel: 'position', attribute: 'P' }],
        props: { cellSize: 10, extruded: false },
      },
      {
        id: 'labels',
        kind: 'text',
        data: data(
          2,
          [
            ['P', P, 2],
            ['C', new Float32Array([1, 0, 0, 0, 0, 1]), 3],
            ['Z', new Float32Array([1, 2]), 1],
          ],
          [['N', ['a', 'b']]]
        ),
        bindings: [
          { channel: 'position', attribute: 'P' },
          { channel: 'text', attribute: 'N' },
          { channel: 'color', attribute: 'C' },
          { channel: 'size', attribute: 'Z' },
        ],
        props: { size: 10 },
      },
      {
        id: 'screen',
        kind: 'screen-grid',
        data: data(2, [['P', P, 2]]),
        bindings: [{ channel: 'position', attribute: 'P' }],
        props: { cellSizePixels: 20 },
      },
      {
        id: 'iso',
        kind: 'contour',
        data: data(2, [['P', P, 2]]),
        bindings: [{ channel: 'position', attribute: 'P' }],
        props: { cellSize: 10, contours: '[{"threshold":1,"color":[255,255,255]}]' },
      },
    ])
    expect([...built.keys()]).toEqual(['lines', 'cloud', 'cells', 'labels', 'screen', 'iso'])
    // deck's own names: its bundle renames some classes
    const kinds = [...built.values()]
      .flat()
      .map(l => (l.constructor as unknown as { layerName: string }).layerName)
    expect(kinds).toEqual([
      'LineLayer',
      'PointCloudLayer',
      'GridCellLayer',
      'TextLayer',
      'ScreenGridLayer',
      'ContourLayer',
    ])
    const texts = (
      (built.get('labels') ?? [])[0].props as unknown as {
        data: { color?: number[]; size?: number }[]
      }
    ).data
    // Per-row colors arrive as 0–255, per-row sizes as multipliers
    expect(texts.map(t => [t.color?.slice(0, 3), t.size])).toEqual([
      [[255, 0, 0], 1],
      [[0, 0, 255], 2],
    ])
    // Every kind renders with no errors (draw throws on one), and the red line shows
    const pixel = await draw([...built.values()].flat())
    const all = Array.from({ length: 100 * 100 }, (_, k) => pixel(k % 100, Math.floor(k / 100)))
    expect(all.some(p => p[0] === 255 && p[1] === 0 && p[2] === 0 && p[3] === 255)).toBe(true)
  }, 60_000)
})

describe('DeckLayerBuilder style props', () => {
  const rows = (n: number, attributes: [string, Float32Array, number][] = []) => ({
    rows: n,
    attributes: new Map(attributes.map(([name, values, width]) => [name, { data: values, width }])),
    strings: new Map(),
    evalMs: 0,
    code: '',
  })
  const P = new Float32Array([0, 0, 1, 1])
  const build = (kind: string, props: Record<string, unknown>, bindings = [['position', 'P']]) => {
    const layers =
      new DeckLayerBuilder()
        .build([
          {
            id: 'it',
            kind: kind as never,
            data: rows(2, [['P', P, 2]]),
            bindings: bindings.map(([channel, attribute]) => ({ channel, attribute })),
            props: props as never,
          },
        ])
        .get('it') ?? []
    return layers.map(l => l.props as unknown as Record<string, unknown>)
  }

  it('passes outlines, facing and antialiasing to a scatterplot', () => {
    const [p] = build('scatter', {
      stroked: true,
      lineColor: [10, 20, 30],
      lineWidthScale: 3,
      lineWidthUnits: 'meters',
      billboard: true,
      antialiasing: false,
    })
    expect(p).toMatchObject({
      stroked: true,
      getLineColor: [10, 20, 30, 255],
      getLineWidth: 1,
      lineWidthScale: 3,
      lineWidthUnits: 'meters',
      billboard: true,
      antialiasing: false,
    })
  })

  it('keeps a trigger for every constant color, not only the last', () => {
    const [p] = build('scatter', { fillColor: [1, 2, 3], lineColor: [4, 5, 6] })
    expect(p.updateTriggers).toMatchObject({ getFillColor: '1,2,3,255', getLineColor: '4,5,6,255' })
  })

  it('reads 0 as no pixel limit, and a pair of numbers as a domain', () => {
    expect(build('line', { widthMaxPixels: 0 })[0].widthMaxPixels).toBe(Number.MAX_SAFE_INTEGER)
    expect(build('line', { widthMaxPixels: 8 })[0].widthMaxPixels).toBe(8)
    const [hex] = build('hexagon', { colorDomain: '0, 50', elevationRange: '10, 20' })
    expect(hex).toMatchObject({ colorDomain: [0, 50], elevationRange: [10, 20] })
    expect(build('hexagon', { colorDomain: '' })[0].colorDomain).not.toEqual([0, 50])
  })

  it('shapes path ends and joints, and columns', () => {
    const [path] = build('path', {
      capRounded: false,
      jointRounded: false,
      miterLimit: 2,
    })
    expect(path).toMatchObject({
      capRounded: false,
      jointRounded: false,
      miterLimit: 2,
    })
    const [column] = build('column', {
      radiusUnits: 'pixels',
      diskResolution: 6,
      offsetX: 0.5,
      extruded: false,
      stroked: true,
      lineColor: [0, 0, 0],
      wireframe: true,
    })
    expect(column).toMatchObject({
      radiusUnits: 'pixels',
      diskResolution: 6,
      offset: [0.5, 0],
      extruded: false,
      stroked: true,
      getLineColor: [0, 0, 0, 255],
      wireframe: true,
    })
  })

  it('wraps and pads text, and caps an icon', () => {
    const texts = (kind: string, props: Record<string, unknown>) =>
      new DeckLayerBuilder()
        .build([
          {
            id: 't',
            kind: kind as never,
            data: {
              ...rows(1, [['P', new Float32Array([0, 0]), 2]]),
              strings: new Map([['T', ['hi']]]),
            },
            bindings: [
              { channel: 'position', attribute: 'P' },
              { channel: kind === 'text' ? 'text' : 'icon', attribute: 'T' },
            ],
            props: props as never,
          },
        ])
        .get('t')?.[0]?.props as unknown as Record<string, unknown>
    expect(
      texts('text', { maxWidth: 0, backgroundPadding: 4, wordBreak: 'break-all' })
    ).toMatchObject({
      maxWidth: -1,
      backgroundPadding: [4, 4],
      wordBreak: 'break-all',
    })
    expect(texts('icon', { sizeMaxPixels: 64, sizeBasis: 'width' })).toMatchObject({
      sizeMaxPixels: 64,
      sizeBasis: 'width',
    })
  })
})

describe('DeckLayerBuilder longitude wrapping', () => {
  // One path from 179° east across the antimeridian to 179° west, red turning blue
  const crossing = (props: Record<string, unknown>) =>
    new DeckLayerBuilder()
      .build([
        {
          id: 'route',
          kind: 'path',
          data: {
            rows: 2,
            starts: new Uint32Array([0]),
            attributes: new Map([
              ['P', { data: new Float32Array([179, 0, -179, 2]), width: 2 }],
              ['C', { data: new Float32Array([1, 0, 0, 0, 0, 1]), width: 3 }],
            ]),
            strings: new Map(),
            evalMs: 0,
            code: '',
          },
          bindings: [
            { channel: 'position', attribute: 'P' },
            { channel: 'color', attribute: 'C' },
          ],
          props: props as never,
        },
      ])
      .get('route')?.[0]?.props.data as unknown as {
      length: number
      startIndices: Uint32Array
      attributes: Record<string, { value: ArrayLike<number> }>
    }

  it('cuts a path at ±180° when wrapping, meeting the edge halfway in every attribute', () => {
    const data = crossing({ wrapLongitude: true })
    expect(data.length).toBe(2)
    expect(Array.from(data.startIndices)).toEqual([0, 2])
    expect(Array.from(data.attributes.getPath.value)).toEqual([
      179, 0, 0, 180, 1, 0, -180, 1, 0, -179, 2, 0,
    ])
    // The color where it crosses is halfway from red to blue, on both sides
    expect(Array.from(data.attributes.getColor.value).slice(4, 12)).toEqual([
      127, 0, 127, 255, 127, 0, 127, 255,
    ])
  })

  it('draws the path whole when not wrapping', () => {
    expect(crossing({}).length).toBe(1)
  })
})
