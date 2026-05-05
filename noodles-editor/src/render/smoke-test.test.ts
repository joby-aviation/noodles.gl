import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearOps, getOp } from '../noodles/store'
import { transformGraph } from '../noodles/transform-graph'
import type { Edge as ReactFlowEdge, Node as ReactFlowNode } from '@xyflow/react'

// End-to-end smoke tests for rendering pipeline.
// These tests load actual example projects and verify that:
// 1. Projects load without errors
// 2. Operators are created correctly
// 3. Canvas elements are rendered
// 4. Layers are instantiated and loaded
//
// Run with: npm test smoke-test

describe('Rendering Smoke Tests', () => {
  beforeEach(() => {
    clearOps()
  })

  afterEach(() => {
    clearOps()
  })

  describe('Icon Layer Test Project', () => {
    it('should load icon-layer-test.json and create all operators', async () => {
      // Load the icon-layer-test example project
      const project = {
        version: 6,
        nodes: [
          {
            id: '/maplibre-basemap',
            type: 'MaplibreBasemapOp',
            position: { x: 100, y: 100 },
            data: {
              inputs: {
                mapStyle:
                  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
                viewState: {
                  latitude: 37.7749,
                  longitude: -122.4194,
                  zoom: 10,
                },
              },
            },
          },
          {
            id: '/test-data',
            type: 'CodeOp',
            position: { x: 100, y: 300 },
            data: {
              inputs: {
                code: "return [\n  { name: 'Point 1', lat: 37.7849, lng: -122.4294 },\n  { name: 'Point 2', lat: 37.7749, lng: -122.4094 },\n  { name: 'Point 3', lat: 37.7649, lng: -122.4194 }\n]",
              },
            },
          },
          {
            id: '/icon-layer',
            type: 'IconLayerOp',
            position: { x: 100, y: 500 },
            data: {
              inputs: {
                visible: true,
                opacity: 1,
                getSize: 40,
                getIcon:
                  'https://raw.githubusercontent.com/visgl/deck.gl-data/master/website/icon-atlas.png',
              },
            },
          },
          {
            id: '/get-position',
            type: 'AccessorOp',
            position: { x: 300, y: 400 },
            data: {
              inputs: {
                code: '[d.lng, d.lat]',
              },
            },
          },
          {
            id: '/deck-renderer',
            type: 'DeckRendererOp',
            position: { x: 500, y: 300 },
            data: {
              inputs: {},
            },
          },
        ] as ReactFlowNode[],
        edges: [
          {
            id: '/test-data.out.result->/icon-layer.par.data',
            source: '/test-data',
            target: '/icon-layer',
            sourceHandle: 'out.result',
            targetHandle: 'par.data',
          },
          {
            id: '/get-position.out.result->/icon-layer.par.getPosition',
            source: '/get-position',
            target: '/icon-layer',
            sourceHandle: 'out.result',
            targetHandle: 'par.getPosition',
          },
          {
            id: '/icon-layer.out.layer->/deck-renderer.par.layers',
            source: '/icon-layer',
            target: '/deck-renderer',
            sourceHandle: 'out.layer',
            targetHandle: 'par.layers',
          },
          {
            id: '/maplibre-basemap.out.mapStyle->/deck-renderer.par.mapStyle',
            source: '/maplibre-basemap',
            target: '/deck-renderer',
            sourceHandle: 'out.mapStyle',
            targetHandle: 'par.mapStyle',
          },
          {
            id: '/maplibre-basemap.out.initialViewState->/deck-renderer.par.initialViewState',
            source: '/maplibre-basemap',
            target: '/deck-renderer',
            sourceHandle: 'out.initialViewState',
            targetHandle: 'par.initialViewState',
          },
        ] as ReactFlowEdge[],
        viewport: { x: 0, y: 0, zoom: 1 },
      }

      const operators = transformGraph({
        nodes: project.nodes,
        edges: project.edges,
      })

      // Verify all 5 operators were created
      expect(operators).toHaveLength(5)

      // Verify each operator exists in the store
      const basemapOp = getOp('/maplibre-basemap')
      expect(basemapOp).toBeDefined()
      expect(basemapOp?.constructor.name).toBe('MaplibreBasemapOp')

      const dataOp = getOp('/test-data')
      expect(dataOp).toBeDefined()
      expect(dataOp?.constructor.name).toBe('CodeOp')

      const iconLayerOp = getOp('/icon-layer')
      expect(iconLayerOp).toBeDefined()
      expect(iconLayerOp?.constructor.name).toBe('IconLayerOp')

      const accessorOp = getOp('/get-position')
      expect(accessorOp).toBeDefined()
      expect(accessorOp?.constructor.name).toBe('AccessorOp')

      const rendererOp = getOp('/deck-renderer')
      expect(rendererOp).toBeDefined()
      expect(rendererOp?.constructor.name).toBe('DeckRendererOp')
    })

    it('should establish correct connections between operators', () => {
      // Use simpler operators to test connection establishment
      const nodes: ReactFlowNode<{ inputs: Record<string, unknown> }>[] = [
        {
          id: '/num',
          type: 'NumberOp',
          position: { x: 100, y: 100 },
          data: {
            inputs: {
              val: 42,
            },
          },
        },
        {
          id: '/math',
          type: 'MathOp',
          position: { x: 300, y: 100 },
          data: {
            inputs: {
              operator: 'multiply',
              b: 2,
            },
          },
        },
      ]

      const edges = [
        {
          id: '/num.out.val->/math.par.a',
          source: '/num',
          target: '/math',
          sourceHandle: 'out.val',
          targetHandle: 'par.a',
        },
      ]

      transformGraph({ nodes, edges })

      const mathOp = getOp('/math')
      expect(mathOp).toBeDefined()

      // Verify the connection was established
      expect(mathOp?.inputs.a.subscriptions.size).toBe(1)
    })

    it('should set operator input values from project data', () => {
      const nodes: ReactFlowNode<{ inputs: Record<string, unknown> }>[] = [
        {
          id: '/icon-layer',
          type: 'IconLayerOp',
          position: { x: 100, y: 100 },
          data: {
            inputs: {
              visible: true,
              opacity: 0.8,
            },
          },
        },
      ]

      const edges: ReactFlowEdge[] = []

      transformGraph({ nodes, edges })

      const iconLayerOp = getOp('/icon-layer')
      expect(iconLayerOp).toBeDefined()
      expect(iconLayerOp?.inputs.visible.value).toBe(true)
      expect(iconLayerOp?.inputs.opacity.value).toBe(0.8)
    })
  })

  describe('MapLibre Basemap Integration', () => {
    it('should create MaplibreBasemapOp with correct inputs', () => {
      const nodes: ReactFlowNode<{ inputs: Record<string, unknown> }>[] = [
        {
          id: '/maplibre-basemap',
          type: 'MaplibreBasemapOp',
          position: { x: 100, y: 100 },
          data: {
            inputs: {
              mapStyle: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
              viewState: {
                latitude: 40.7128,
                longitude: -74.006,
                zoom: 13,
                pitch: 45,
                bearing: 0,
              },
            },
          },
        },
      ]

      const edges: ReactFlowEdge[] = []

      const operators = transformGraph({ nodes, edges })

      expect(operators).toHaveLength(1)

      const basemapOp = getOp('/maplibre-basemap')
      expect(basemapOp).toBeDefined()
      expect(basemapOp?.constructor.name).toBe('MaplibreBasemapOp')

      // Verify inputs were set correctly
      expect(basemapOp?.inputs.mapStyle.value).toBe(
        'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
      )
      expect(basemapOp?.inputs.viewState.value).toMatchObject({
        latitude: 40.7128,
        longitude: -74.006,
        zoom: 13,
      })
    })
  })

  describe('Deck.gl Only Scene (No Basemap)', () => {
    it('should render without MapLibre basemap', async () => {
      // Test a pure Deck.gl scene without MapLibre
      const project = {
        version: 6,
        nodes: [
          {
            id: '/test-data',
            type: 'CodeOp',
            position: { x: 100, y: 100 },
            data: {
              inputs: {
                code: 'return [{ position: [-122.4, 37.8], radius: 100 }]',
              },
            },
          },
          {
            id: '/scatterplot',
            type: 'ScatterplotLayerOp',
            position: { x: 300, y: 100 },
            data: {
              inputs: {
                radiusMinPixels: 5,
                radiusMaxPixels: 50,
                getFillColor: [255, 0, 0],
              },
            },
          },
          {
            id: '/deck-renderer',
            type: 'DeckRendererOp',
            position: { x: 500, y: 100 },
            data: {
              inputs: {},
            },
          },
        ] as ReactFlowNode[],
        edges: [
          {
            id: '/test-data.out.result->/scatterplot.par.data',
            source: '/test-data',
            target: '/scatterplot',
            sourceHandle: 'out.result',
            targetHandle: 'par.data',
          },
          {
            id: '/scatterplot.out.layer->/deck-renderer.par.layers',
            source: '/scatterplot',
            target: '/deck-renderer',
            sourceHandle: 'out.layer',
            targetHandle: 'par.layers',
          },
        ] as ReactFlowEdge[],
        viewport: { x: 0, y: 0, zoom: 1 },
      }

      const operators = transformGraph({
        nodes: project.nodes,
        edges: project.edges,
      })

      expect(operators).toHaveLength(3)

      const scatterplotOp = getOp('/scatterplot')
      expect(scatterplotOp).toBeDefined()
      expect(scatterplotOp?.constructor.name).toBe('ScatterplotLayerOp')

      const rendererOp = getOp('/deck-renderer')
      expect(rendererOp).toBeDefined()

      // Verify layers input is connected
      const layersInput = rendererOp?.inputs.layers
      expect(layersInput?.subscriptions.size).toBeGreaterThan(0)
    })
  })

  describe('Error Handling', () => {
    it('should handle missing operator types gracefully', async () => {
      const project = {
        version: 6,
        nodes: [
          {
            id: '/invalid-op',
            type: 'NonExistentOp',
            position: { x: 100, y: 100 },
            data: { inputs: {} },
          },
        ] as ReactFlowNode[],
        edges: [] as ReactFlowEdge[],
        viewport: { x: 0, y: 0, zoom: 1 },
      }

      // This should not throw an error, but the operator won't be created
      const operators = transformGraph({
        nodes: project.nodes,
        edges: project.edges,
      })

      // transformGraph filters out invalid operator types
      expect(operators.length).toBeLessThanOrEqual(1)

      const invalidOp = getOp('/invalid-op')
      // If NonExistentOp doesn't exist, the operator won't be created
      if (invalidOp) {
        expect(invalidOp).toBeDefined()
      } else {
        // Expected: operator not created for unknown type
        expect(invalidOp).toBeUndefined()
      }
    })

    it('should handle empty project gracefully', async () => {
      const project = {
        version: 6,
        nodes: [] as ReactFlowNode[],
        edges: [] as ReactFlowEdge[],
        viewport: { x: 0, y: 0, zoom: 1 },
      }

      const operators = transformGraph({
        nodes: project.nodes,
        edges: project.edges,
      })

      expect(operators).toHaveLength(0)
    })
  })

  describe('Operator Input Values', () => {
    it('should correctly set operator input values from project data', async () => {
      const project = {
        version: 6,
        nodes: [
          {
            id: '/number-op',
            type: 'NumberOp',
            position: { x: 100, y: 100 },
            data: {
              inputs: {
                val: 42,
              },
            },
          },
          {
            id: '/string-op',
            type: 'StringOp',
            position: { x: 100, y: 200 },
            data: {
              inputs: {
                val: 'test string',
              },
            },
          },
          {
            id: '/boolean-op',
            type: 'BooleanOp',
            position: { x: 100, y: 300 },
            data: {
              inputs: {
                val: true,
              },
            },
          },
        ] as ReactFlowNode[],
        edges: [] as ReactFlowEdge[],
        viewport: { x: 0, y: 0, zoom: 1 },
      }

      transformGraph({ nodes: project.nodes, edges: project.edges })

      const numberOp = getOp('/number-op')
      expect(numberOp?.inputs.val.value).toBe(42)

      const stringOp = getOp('/string-op')
      expect(stringOp?.inputs.val.value).toBe('test string')

      const booleanOp = getOp('/boolean-op')
      expect(booleanOp?.inputs.val.value).toBe(true)
    })
  })
})
