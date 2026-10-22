// Regression tests for example graphs whose wiring has been wrong before. Each test
// follows the saved edges upstream from a layer input and runs the real operators
// with the saved inputs, so a dropped edge or a changed setting fails here.
import { describe, expect, it } from 'vitest'
import { ColorRampOp, MapRangeOp, MathOp } from '../noodles/operators'
import type { NoodlesProjectJSON } from '../noodles/utils/serialization'
import earthquakes from './california-earthquakes/noodles.json'
import contours from './sf-elevation-contours/noodles.json'

// The node and output handle feeding `target`'s `targetHandle`
function upstream(project: NoodlesProjectJSON, target: string, targetHandle: string) {
  const edge = project.edges.find(e => e.target === target && e.targetHandle === targetHandle)
  if (!edge) throw new Error(`Nothing connected to ${target}.${targetHandle}`)
  return { id: edge.source, handle: edge.sourceHandle }
}

function savedInputs(project: NoodlesProjectJSON, id: string) {
  const node = project.nodes.find(n => n.id === id)
  if (!node) throw new Error(`No node ${id}`)
  return (node.data?.inputs ?? {}) as Record<string, unknown>
}

describe('california-earthquakes', () => {
  const project = earthquakes as unknown as NoodlesProjectJSON

  it('scales radius by the square root of magnitude', async () => {
    const multiply = upstream(project, '/scatterplot-layer', 'par.getRadius')
    expect(multiply).toEqual({ id: '/multiply', handle: 'out.result' })
    const sqrt = upstream(project, '/multiply', 'par.a')
    expect(sqrt).toEqual({ id: '/sqrt', handle: 'out.result' })
    expect(upstream(project, '/sqrt', 'par.a').id).toBe('/magnitude-accessor')

    const radius = async (magnitude: number) => {
      const root = await new MathOp('/sqrt', {
        ...savedInputs(project, '/sqrt'),
        a: magnitude,
      }).pull()
      const scaled = await new MathOp('/multiply', {
        ...savedInputs(project, '/multiply'),
        a: root.result,
      }).pull()
      return scaled.result as number
    }

    // A median quake keeps the radius it had before /sqrt was wired in
    expect(await radius(2.86)).toBeCloseTo(2875, -1)
    expect(await radius(4)).toBeCloseTo(2 * (await radius(1)))
  })
})

describe('sf-elevation-contours', () => {
  const project = contours as unknown as NoodlesProjectJSON

  it('colors contours by elevation across the ramp', async () => {
    const color = upstream(project, '/geojson-layer', 'par.getLineColor')
    expect(color.id).toBe('/elevation-color')
    const range = upstream(project, '/elevation-color', 'par.value')
    expect(range).toEqual({ id: '/elevation-range', handle: 'out.scaled' })
    expect(upstream(project, '/elevation-range', 'par.val').id).toBe('/elevation-accessor')

    const colorAt = async (elevation: number) => {
      const scaled = await new MapRangeOp('/elevation-range', {
        ...savedInputs(project, '/elevation-range'),
        val: elevation,
      }).pull()
      const ramp = await new ColorRampOp('/elevation-color', {
        ...savedInputs(project, '/elevation-color'),
        value: scaled.scaled,
      }).pull()
      return ramp.color
    }

    // Before the range was added, every elevation above 1 ft got the top color
    const colors = await Promise.all([0, 300, 600, 900].map(colorAt))
    expect(new Set(colors).size).toBe(4)
  })
})
