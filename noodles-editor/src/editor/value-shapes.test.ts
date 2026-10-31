import type { EditorDoc } from '@noodles.gl/planner'
import { beforeAll, describe, expect, it } from 'vitest'
import { registerDeckOperators } from '../runtime/deck-ops'
import { connect, validConnection } from './doc-ops'
import { linkParam, outputKey, targetsOn } from './param-links'

beforeAll(() => registerDeckOperators())

const doc = (): EditorDoc => ({
  version: 1,
  name: 'shapes',
  nodes: [
    { id: 'shot', op: 'view-state', name: 'shot', x: 0, y: 0, params: { zoom: 9 } },
    { id: 'look', op: 'map-style', name: 'look', x: 0, y: 0, params: {} },
    { id: 'pick', op: 'switch-value', name: 'pick', x: 0, y: 0, params: {} },
    { id: 'map', op: 'deck', name: 'map', x: 300, y: 0, params: {} },
  ],
  edges: [],
})

describe('value shapes', () => {
  it('wires a camera only into a camera, and a map style only into a map style', () => {
    const d = doc()
    expect(validConnection(d, 'shot', 'viewState', 'map', 'viewState')).toBe(true)
    expect(validConnection(d, 'shot', 'viewState', 'map', 'par:mapStyle')).toBe(false)
    expect(validConnection(d, 'look', 'mapStyle', 'map', 'par:mapStyle')).toBe(true)
    expect(validConnection(d, 'look', 'mapStyle', 'map', 'viewState')).toBe(false)
    // A value of no one shape (a Switch Value's) goes anywhere a value does
    expect(validConnection(d, 'pick', 'value', 'map', 'viewState')).toBe(true)
    expect(validConnection(d, 'pick', 'value', 'map', 'par:mapStyle')).toBe(true)
  })

  it('offers a View State dropped on a deck its view state, exactly, and not the map style', () => {
    const d = doc()
    const items = targetsOn(d, 'map', outputKey('shot', 'viewState'))
    expect(items[0]).toMatchObject({ key: 'map<viewState', exact: true })
    expect(items.some(i => i.key === 'map.mapStyle')).toBe(false)
    expect(items.filter(i => i.exact)).toHaveLength(1)
    expect(linkParam(d, outputKey('shot', 'viewState'), 'map<viewState')).toBe(true)
    expect(d.edges).toContainEqual(
      expect.objectContaining({
        source: 'shot',
        sourcePort: 'viewState',
        target: 'map',
        targetPort: 'viewState',
      })
    )
  })

  it('still offers a value of no one shape every place it fits, to choose from', () => {
    const d = doc()
    connect(d, 'shot', 'viewState', 'pick', 'par:values')
    const items = targetsOn(d, 'map', outputKey('pick', 'value'))
    expect(items.map(i => i.key)).toEqual(expect.arrayContaining(['map<viewState', 'map.mapStyle']))
    expect(items.some(i => i.exact)).toBe(false)
  })
})
