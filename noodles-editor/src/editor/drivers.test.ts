import { type DocNode, type EditorDoc, OPERATOR_INDEX } from '@noodles.gl/planner'
import { beforeAll, describe, expect, it } from 'vitest'
import { registerDeckOperators } from '../runtime/deck-ops'
import { disconnectInput, driversFor, driveWith } from './drivers'

beforeAll(() => registerDeckOperators())

const doc = (): EditorDoc => ({
  version: 1,
  name: 'drive',
  nodes: [
    { id: 'group', op: 'subnet', x: 0, y: 0, params: {} },
    { id: 'dots', op: 'scatter', x: 400, y: 100, parent: 'group', params: { radiusScale: 6 } },
    { id: 'map', op: 'deck', x: 800, y: 0, params: { basemap: 'voyager' } },
  ],
  edges: [],
})
const at = (d: EditorDoc, id: string) => d.nodes.find(n => n.id === id) as DocNode
const param = (op: string, name: string) => {
  const def = OPERATOR_INDEX.get(op)?.params.find(p => p.name === name)
  if (!def) throw new Error(`no ${op}.${name}`)
  return def
}

describe('Drive with', () => {
  it('offers number drivers for a number, a Map Style for a deck’s style, nothing for a wired one', () => {
    const d = doc()
    expect(driversFor(d, at(d, 'dots'), param('scatter', 'radiusScale')).map(x => x.op)).toEqual([
      'number',
      'time',
      'math',
      'expression',
    ])
    expect(driversFor(d, at(d, 'map'), param('deck', 'mapStyle')).map(x => x.op)).toEqual([
      'map-style',
    ])
    expect(driversFor(d, at(d, 'dots'), param('scatter', 'radiusUnits'))).toEqual([])
    driveWith(d, at(d, 'dots'), param('scatter', 'radiusScale'), { op: 'number', label: '' }, 6)
    expect(driversFor(d, at(d, 'dots'), param('scatter', 'radiusScale'))).toEqual([])
  })

  it('makes the driver beside the node, in its network, wired in and starting from its value', () => {
    const d = doc()
    const def = param('scatter', 'radiusScale')
    const id = driveWith(d, at(d, 'dots'), def, { op: 'number', label: 'Number' }, 6)
    expect(at(d, id as string)).toMatchObject({
      op: 'number',
      parent: 'group',
      params: { value: 6 },
    })
    expect(d.edges).toContainEqual(
      expect.objectContaining({ source: id, target: 'dots', targetPort: 'par:radiusScale' })
    )
    const math = driveWith(doc(), at(doc(), 'dots'), def, { op: 'math', label: 'Math' }, 6)
    expect(math).toBeDefined()
  })

  it('moves a deck’s style into the Map Style node that drives it', () => {
    const d = doc()
    const id = driveWith(
      d,
      at(d, 'map'),
      param('deck', 'mapStyle'),
      { op: 'map-style', label: '' },
      ''
    )
    expect(at(d, id as string)).toMatchObject({
      op: 'map-style',
      params: { baseStyle: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json' },
    })
    expect(d.edges).toContainEqual(
      expect.objectContaining({ source: id, target: 'map', targetPort: 'par:mapStyle' })
    )
  })

  it('disconnects a driver, keeping the value it gave', () => {
    const d = doc()
    const def = param('scatter', 'radiusScale')
    driveWith(d, at(d, 'dots'), def, { op: 'time', label: 'Time' }, 6)
    disconnectInput(d, at(d, 'dots'), def, 12.5)
    expect(d.edges).toEqual([])
    expect(at(d, 'dots').params.radiusScale).toBe(12.5)
  })
})
