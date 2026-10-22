import type { EditorDoc } from '@noodles.gl/planner'
import { describe, expect, it } from 'vitest'
import { isHostOperator, registerHostOperators } from './host-ops'
import { HostRunner } from './host-runner'

const doc = (opacity: number, wired = false): EditorDoc => ({
  version: 1,
  name: 'host',
  nodes: [
    { id: '/level', op: 'number', x: 0, y: 0, params: { value: 0.25 } },
    {
      id: '/bitmap',
      op: 'BitmapLayerOp',
      x: 0,
      y: 0,
      params: { image: 'https://example.com/a.png', opacity },
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
    expect(types).toContain('BitmapLayerOp')
    expect(types).toContain('CodeOp')
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
