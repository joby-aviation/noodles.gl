import { beforeEach, describe, expect, it } from 'vitest'
import {
  claimStarterSelection,
  findStarterNodeId,
  panViewportToShow,
  resetStarterSelectionForTests,
  type StarterNodeProject,
} from './starter-node'

const isLayerType = (type: string) => type.endsWith('LayerOp')

const node = (id: string, type: string) => ({ id, type })
const edge = (source: string, target: string, targetHandle: string) => ({
  source,
  target,
  targetHandle,
})

describe('findStarterNodeId', () => {
  it('picks the first layer wired into the renderer, in edge order', () => {
    const project: StarterNodeProject = {
      nodes: [
        node('/basemap', 'MaplibreBasemapOp'),
        node('/arc-layer', 'ArcLayerOp'),
        node('/pickup-layer', 'ScatterplotLayerOp'),
        node('/deck', 'DeckRendererOp'),
      ],
      edges: [
        edge('/basemap', '/deck', 'par.basemap'),
        edge('/pickup-layer', '/deck', 'par.layers'),
        edge('/arc-layer', '/deck', 'par.layers'),
      ],
    }
    expect(findStarterNodeId(project, isLayerType)).toBe('/pickup-layer')
  })

  it('looks upstream through operators that pass layers along', () => {
    const project: StarterNodeProject = {
      nodes: [
        node('/data', 'FileOp'),
        node('/hexagon-layer', 'HexagonLayerOp'),
        node('/grid-layer', 'GridLayerOp'),
        node('/switch', 'SwitchOp'),
        node('/deck', 'DeckRendererOp'),
      ],
      edges: [
        edge('/switch', '/deck', 'par.layers'),
        edge('/hexagon-layer', '/switch', 'par.values'),
        edge('/grid-layer', '/switch', 'par.values'),
        edge('/data', '/hexagon-layer', 'par.data'),
      ],
    }
    expect(findStarterNodeId(project, isLayerType)).toBe('/hexagon-layer')
  })

  it('prefers a layer wired straight in over one behind another operator', () => {
    const project: StarterNodeProject = {
      nodes: [
        node('/hidden-layer', 'ScatterplotLayerOp'),
        node('/switch', 'SwitchOp'),
        node('/direct-layer', 'PathLayerOp'),
        node('/deck', 'DeckRendererOp'),
      ],
      edges: [
        edge('/switch', '/deck', 'par.layers'),
        edge('/direct-layer', '/deck', 'par.layers'),
        edge('/hidden-layer', '/switch', 'par.values'),
      ],
    }
    expect(findStarterNodeId(project, isLayerType)).toBe('/direct-layer')
  })

  it('skips layers inside containers, since the graph opens at the root', () => {
    const project: StarterNodeProject = {
      nodes: [
        node('/group', 'ContainerOp'),
        node('/group/inner-layer', 'ScatterplotLayerOp'),
        node('/deck', 'DeckRendererOp'),
      ],
      edges: [
        edge('/group', '/deck', 'par.layers'),
        edge('/group/inner-layer', '/group', 'par.in'),
      ],
    }
    expect(findStarterNodeId(project, isLayerType)).toBeNull()
  })

  it('returns null without a renderer or without layers', () => {
    expect(
      findStarterNodeId({ nodes: [node('/layer', 'ScatterplotLayerOp')], edges: [] }, isLayerType)
    ).toBeNull()
    expect(
      findStarterNodeId({ nodes: [node('/deck', 'DeckRendererOp')], edges: [] }, isLayerType)
    ).toBeNull()
  })

  it('does not loop forever on a cycle', () => {
    const project: StarterNodeProject = {
      nodes: [node('/a', 'CodeOp'), node('/b', 'CodeOp'), node('/deck', 'DeckRendererOp')],
      edges: [
        edge('/a', '/deck', 'par.layers'),
        edge('/b', '/a', 'par.data'),
        edge('/a', '/b', 'par.data'),
      ],
    }
    expect(findStarterNodeId(project, isLayerType)).toBeNull()
  })

  it('uses editorSettings.startNode when it names a root node', () => {
    const project: StarterNodeProject = {
      nodes: [
        node('/first-layer', 'ScatterplotLayerOp'),
        node('/controls', 'NumberOp'),
        node('/deck', 'DeckRendererOp'),
      ],
      edges: [edge('/first-layer', '/deck', 'par.layers')],
      editorSettings: { startNode: '/controls' },
    }
    expect(findStarterNodeId(project, isLayerType)).toBe('/controls')
  })

  it('falls back to the heuristic when startNode is missing from the graph', () => {
    const project: StarterNodeProject = {
      nodes: [node('/first-layer', 'ScatterplotLayerOp'), node('/deck', 'DeckRendererOp')],
      edges: [edge('/first-layer', '/deck', 'par.layers')],
      editorSettings: { startNode: '/renamed' },
    }
    expect(findStarterNodeId(project, isLayerType)).toBe('/first-layer')
  })
})

describe('claimStarterSelection', () => {
  beforeEach(() => resetStarterSelectionForTests())

  const example = { exampleId: 'nyc-taxis', fromBundledExample: true, agentControlled: false }

  it('claims an example only once per session', () => {
    expect(claimStarterSelection(example)).toBe(true)
    expect(claimStarterSelection(example)).toBe(false)
    expect(claimStarterSelection({ ...example, exampleId: 'world-flights' })).toBe(true)
  })

  it('never claims a copy the user may have edited', () => {
    expect(claimStarterSelection({ ...example, fromBundledExample: false })).toBe(false)
    // The bundled load that follows still gets its selection
    expect(claimStarterSelection(example)).toBe(true)
  })

  it('never claims when an agent drives the editor', () => {
    expect(claimStarterSelection({ ...example, agentControlled: true })).toBe(false)
  })
})

describe('panViewportToShow', () => {
  const pane = { width: 1000, height: 500 }

  it('leaves the view alone when the node is already on screen', () => {
    const viewport = { x: 0, y: 0, zoom: 1 }
    expect(
      panViewportToShow({ x: 100, y: 100, width: 200, height: 100 }, viewport, pane)
    ).toBeNull()
  })

  it('centers an off-screen node without changing the zoom', () => {
    const viewport = { x: 0, y: 0, zoom: 2 }
    const next = panViewportToShow({ x: 1000, y: 1000, width: 100, height: 50 }, viewport, pane)
    expect(next).toEqual({ x: -1600, y: -1800, zoom: 2 })
  })

  it('only moves the axis the node overflows', () => {
    const viewport = { x: 0, y: 0, zoom: 1 }
    const next = panViewportToShow({ x: 100, y: 600, width: 200, height: 100 }, viewport, pane)
    expect(next).toEqual({ x: 0, y: -400, zoom: 1 })
  })

  it('lines up a node taller than the pane by its top edge', () => {
    const viewport = { x: 0, y: 0, zoom: 1 }
    const next = panViewportToShow({ x: 100, y: -300, width: 200, height: 800 }, viewport, pane)
    expect(next).toEqual({ x: 0, y: 324, zoom: 1 })
  })
})
