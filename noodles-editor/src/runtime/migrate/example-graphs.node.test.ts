// Examples whose wiring has been wrong before, run as the documents they convert to: a dropped
// edge or a changed setting fails here.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { lowerDocument, parameterValues } from '@noodles.gl/planner'
import { beforeAll, describe, expect, it } from 'vitest'
import { type NodeDuck, openNodeDuck } from '../__tests__/duckdb-node'
import { registerDeckOperators } from '../deck-ops'
import { ProgramRuntime } from '../program-runtime'
import { registerNoodlesRamps } from '../ramps'
import { type NoodlesProject, toEditorDoc } from './to-editor-doc'

let duck: NodeDuck
beforeAll(async () => {
  registerNoodlesRamps()
  registerDeckOperators()
  duck = await openNodeDuck()
}, 60_000)

const example = (name: string) =>
  JSON.parse(readFileSync(resolve(`src/examples/${name}/noodles.json`), 'utf8')) as NoodlesProject

async function draw(name: string, files: Record<string, string>) {
  const { doc } = toEditorDoc(example(name))
  for (const n of doc.nodes) {
    const url = String(n.params.url ?? '')
    if (files[url]) duck.registerText(url, files[url])
  }
  const lowered = lowerDocument(doc)
  expect(lowered.errors).toEqual([])
  const runtime = new ProgramRuntime(duck)
  await runtime.setGraph(lowered.graph, parameterValues(lowered, { T: 0, F: 0 }).values)
  expect(runtime.program()?.errors).toEqual([])
  return { doc, layers: Object.fromEntries(runtime.layers().map(l => [l.id, l])) }
}

describe('california-earthquakes', () => {
  it('scales radius by the square root of magnitude', async () => {
    const csv = 'Longitude,Latitude,Magnitude\n-120,36,1\n-121,37,4\n-122,38,2.86\n'
    const { layers } = await draw('california-earthquakes', { '@/data.csv': csv })
    const layer = layers['/scatterplot-layer']
    expect(layer.error).toBeUndefined()
    const radius = layer.data?.attributes.get('multiply')?.data
    expect(radius).toBeDefined()
    // A median quake keeps the radius it had before /sqrt was wired in
    expect(radius?.[2]).toBeCloseTo(2875, -1)
    expect(radius?.[1]).toBeCloseTo(2 * (radius?.[0] ?? 0), 0)
  })
})

describe('sf-elevation-contours', () => {
  it('colors contours by elevation across the ramp', async () => {
    const url =
      'https://raw.githubusercontent.com/keplergl/kepler.gl-data/master/sfcontour/data.json'
    const line = (elevation: number, x: number) => ({
      type: 'Feature',
      properties: { elevation },
      geometry: {
        type: 'LineString',
        coordinates: [
          [x, 0],
          [x, 1],
        ],
      },
    })
    const features = [0, 300, 600, 900].map((e, i) => line(e, i))
    const { layers } = await draw('sf-elevation-contours', {
      [url]: JSON.stringify({ type: 'FeatureCollection', features }),
    })
    const lines = layers['/geojson-layer-lines']
    expect(lines.error).toBeUndefined()
    const color = lines.data?.attributes.get(
      lines.plan.plan.layer?.bindings.find(b => b.channel === 'color')?.attribute ?? ''
    )
    expect(color).toBeDefined()
    // A color per contour, two vertices each: before the range was added, every elevation above
    // 1 ft got the top color
    const perLine = [0, 2, 4, 6].map(v =>
      Array.from(color?.data.subarray(v * color.width, v * color.width + 3) ?? []).join(',')
    )
    expect(new Set(perLine).size).toBe(4)
  })
})
