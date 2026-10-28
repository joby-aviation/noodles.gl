import { type DocNode, type EditorDoc, OPERATOR_INDEX } from '@noodles.gl/planner'
import { beforeAll, describe, expect, it } from 'vitest'
import { registerDeckOperators } from '../runtime/deck-ops'
import { parseStyleChanges } from '../runtime/map-style'
import { compoundsOf } from './compound-params'
import { baseStyleOf, chooseStyle, splitOutStyle, styleLabel } from './map-style-rows'

const group = { basemap: 'basemap', url: 'mapStyle', changes: 'styleOverrides' }
const changes = {
  layers: [{ layerId: 'water', paintOverrides: { 'fill-color': '#f00' } }],
  global: {},
}

const doc = (params: DocNode['params'] = {}): EditorDoc => ({
  version: 1,
  name: 'style',
  nodes: [{ id: 'map', op: 'deck', x: 400, y: 0, params }],
  edges: [],
})
const deck = (d: EditorDoc) => d.nodes.find(n => n.id === 'map') as DocNode

beforeAll(() => registerDeckOperators())

describe('the map style control', () => {
  it('groups the deck’s basemap, URL and style changes into one control', () => {
    const op = OPERATOR_INDEX.get('deck')
    if (!op) throw new Error('no deck')
    const compounds = compoundsOf(op)
    expect(compounds.style).toEqual(group)
    expect(compounds.absorbed.has('basemap')).toBe(true)
    expect(compounds.absorbed.has('styleOverrides')).toBe(true)
    // The URL keeps its row, port and all
    expect(compounds.absorbed.has('mapStyle')).toBe(false)
  })

  it('names the style from the gallery, the basemap menu, or where it comes from', () => {
    expect(styleLabel(deck(doc()), group)).toBe('Dark Matter')
    expect(styleLabel(deck(doc({ basemap: 'positron' })), group)).toBe('Positron')
    const voyagerNoLabels = 'https://basemaps.cartocdn.com/gl/voyager-nolabels-gl-style/style.json'
    expect(styleLabel(deck(doc({ mapStyle: voyagerNoLabels })), group)).toBe('Voyager (No Labels)')
    expect(styleLabel(deck(doc({ mapStyle: 'https://tiles.example.com/s.json' })), group)).toBe(
      'tiles.example.com'
    )
    expect(styleLabel(deck(doc({ mapStyle: '{"version":8}' })), group)).toBe('Custom style')
  })

  it('picks a named basemap by name, any other style by its URL or JSON', () => {
    const d = doc({ mapStyle: 'https://old.example.com/s.json' })
    chooseStyle(d, 'map', group, 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json')
    expect(deck(d).params).toEqual({ basemap: 'positron' })
    chooseStyle(d, 'map', group, 'https://tiles.openfreemap.org/styles/liberty')
    expect(deck(d).params.mapStyle).toBe('https://tiles.openfreemap.org/styles/liberty')
    chooseStyle(d, 'map', group, { version: 8, sources: {}, layers: [] })
    expect(JSON.parse(String(deck(d).params.mapStyle))).toEqual({
      version: 8,
      sources: {},
      layers: [],
    })
    expect(baseStyleOf(deck(d), group)).toEqual({ version: 8, sources: {}, layers: [] })
  })

  it('splits the style and its changes out into a Map Style node wired into the deck', () => {
    const d = doc({ basemap: 'voyager', styleOverrides: JSON.stringify(changes) })
    const id = splitOutStyle(d, 'map', group)
    const style = d.nodes.find(n => n.id === id)
    expect(style).toMatchObject({
      op: 'map-style',
      params: {
        baseStyle: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
        overrides: changes,
      },
    })
    expect(d.edges).toEqual([
      expect.objectContaining({
        source: id,
        sourcePort: 'mapStyle',
        target: 'map',
        targetPort: 'par:mapStyle',
      }),
    ])
    // The changes now live on the node, not the deck
    expect(deck(d).params.styleOverrides).toBeUndefined()
  })

  it('reads empty or unparsable changes as none', () => {
    expect(parseStyleChanges('')).toBeUndefined()
    expect(parseStyleChanges('{not json')).toBeUndefined()
    expect(parseStyleChanges(JSON.stringify({ layers: [], global: {} }))).toBeUndefined()
    expect(parseStyleChanges(JSON.stringify(changes))).toEqual(changes)
  })
})
