import { type DocNode, type EditorDoc, OPERATOR_INDEX, type OpDef } from '@noodles.gl/planner'
import { describe, expect, it } from 'vitest'
import { shownValue, summaryOf } from './node-summary'
import { candidates } from './ref-picker'

const op = (type: string) => OPERATOR_INDEX.get(type) as OpDef
const node = (o: string, params: DocNode['params'] = {}): DocNode => ({
  id: `n-${o}`,
  op: o,
  x: 0,
  y: 0,
  params,
})

describe('node summaries', () => {
  it('say what a node does from its key parameters', () => {
    expect(summaryOf(node('file', { url: '@/data.csv' }), op('file'))).toBe('data.csv')
    expect(
      summaryOf(node('filter', { column: 'Magnitude', op: '>', value: 2.5 }), op('filter'))
    ).toBe('Magnitude > 2.5')
    expect(
      summaryOf(node('attribute', { name: 'P', expression: '[lng, lat]' }), op('attribute'))
    ).toBe('P = [lng, lat]')
    expect(
      summaryOf(
        node('map-range', { input: 'mag', inMin: 2.5, inMax: 7, outMin: 0, outMax: 1 }),
        op('map-range')
      )
    ).toBe('mag: 2.5–7 → 0–1')
    expect(summaryOf(node('scatter', { position: 'pickup_position' }), op('scatter'))).toBe(
      'position ← pickup_position'
    )
    expect(summaryOf(node('sql', { query: '-- top\nSELECT * FROM {{input0}}' }), op('sql'))).toBe(
      'SELECT * FROM {{input0}}'
    )
  })

  it('write expressions and references as themselves', () => {
    expect(shownValue({ expr: 'sin(T)' })).toBe('sin(T)')
    expect(shownValue({ ref: 'pickup/color' })).toBe('→ pickup/color')
    expect(shownValue([141, 18, 175])).toBe('[141, 18, 175]')
  })

  it('cut long text', () => {
    const long = summaryOf(node('sql', { query: `SELECT ${'x, '.repeat(40)}y FROM t` }), op('sql'))
    expect(long?.length).toBeLessThanOrEqual(48)
    expect(long?.endsWith('…')).toBe(true)
  })
})

describe('reference candidates', () => {
  const doc: EditorDoc = {
    version: 1,
    name: 'refs',
    nodes: [
      { id: 'c', op: 'color', name: 'pickup', x: 0, y: 0, params: {} },
      { id: 's', op: 'scatter', name: 'points', x: 0, y: 0, params: {} },
    ],
    edges: [],
  }
  it('offer parameters of the same kind on other nodes', () => {
    const fill = op('scatter').params.find(p => p.name === 'fillColor')
    const list = candidates(doc, doc.nodes[1], fill as never)
    expect(list.map(c => c.label)).toEqual(['/pickup › Color'])
  })
})
