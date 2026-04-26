// Integration test for MapStyleField accepting both URL strings and style objects
// Tests the exact user scenario: JSONOp -> MaplibreBasemapOp (simplified from FileOp -> CodeOp -> MaplibreBasemapOp)
import type { Node as ReactFlowNode } from '@xyflow/react'
import { afterEach, describe, expect, it } from 'vitest'
import { JSONOp, MaplibreBasemapOp } from '../operators'
import { clearOps, getOp } from '../store'
import { transformGraph } from '../transform-graph'

describe('MapStyle Integration Tests', () => {
  afterEach(() => {
    clearOps()
  })

  it('accepts style objects from JSONOp -> MaplibreBasemapOp connection', () => {
    // Create a minimal valid map style object
    const styleObject = {
      version: 8,
      sources: {
        'test-source': {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
        }
      },
      layers: [
        {
          id: 'test-layer',
          type: 'raster',
          source: 'test-source'
        }
      ]
    }

    // Setup nodes - JSONOp parses JSON string to object
    const nodes: ReactFlowNode<{ inputs: Record<string, unknown> }>[] = [
      {
        id: '/json-op',
        type: 'JSONOp',
        position: { x: 0, y: 0 },
        data: {
          inputs: {
            text: JSON.stringify(styleObject)
          }
        },
      },
      {
        id: '/maplibre',
        type: 'MaplibreBasemapOp',
        position: { x: 200, y: 0 },
        data: {
          inputs: {
            viewState: { latitude: 0, longitude: 0, zoom: 1, pitch: 0, bearing: 0 }
          }
        },
      },
    ]

    // Setup connection: JSONOp -> MaplibreBasemapOp.mapStyle
    const edges = [
      {
        id: '/json-op.out.data->/maplibre.par.mapStyle',
        source: '/json-op',
        target: '/maplibre',
        sourceHandle: 'out.data',
        targetHandle: 'par.mapStyle',
      },
    ]

    // Transform graph to establish connections
    transformGraph({ nodes, edges })

    const jsonOp = getOp('/json-op') as JSONOp
    const maplibreOp = getOp('/maplibre') as MaplibreBasemapOp

    // Verify connection is established
    expect(maplibreOp.inputs.mapStyle.subscriptions.size).toBe(1)

    // Execute JSONOp to produce the style object
    const jsonResult = jsonOp.execute({ text: JSON.stringify(styleObject) })
    expect(typeof jsonResult.data).toBe('object')
    expect(jsonResult.data).toEqual(styleObject)

    // Set JSONOp output which should propagate to MaplibreBasemapOp.mapStyle
    jsonOp.outputs.data.next(jsonResult.data)

    // Verify MaplibreBasemapOp's mapStyle field received the object
    const mapStyleValue = maplibreOp.inputs.mapStyle.value
    expect(typeof mapStyleValue).toBe('object')
    expect(mapStyleValue).toHaveProperty('version', 8)
    expect(mapStyleValue).toHaveProperty('sources')
    expect(mapStyleValue).toHaveProperty('layers')

    // Execute MaplibreBasemapOp and verify output passes through the object
    const result = maplibreOp.execute({
      mapStyle: mapStyleValue as unknown as string,
      projection: 'mercator',
      viewState: { latitude: 0, longitude: 0, zoom: 1, pitch: 0, bearing: 0 },
      sky: { enabled: false, skyColor: '#88C6FC', horizonColor: '#ffffff', skyHorizonBlend: 0.8, atmosphereBlend: 0.5 },
      light: { anchor: 'viewport', azimuthal: 210, polar: 30 },
    })

    expect(typeof result.maplibre.mapStyle).toBe('object')
    expect(result.maplibre.mapStyle).toEqual(styleObject)
  })

  it('still accepts URL strings in mapStyle field', () => {
    // Verify backward compatibility - string URLs still work
    const nodes: ReactFlowNode<{ inputs: Record<string, unknown> }>[] = [
      {
        id: '/maplibre',
        type: 'MaplibreBasemapOp',
        position: { x: 0, y: 0 },
        data: {
          inputs: {
            mapStyle: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
            viewState: { latitude: 37, longitude: -122, zoom: 10, pitch: 0, bearing: 0 }
          }
        },
      },
    ]

    transformGraph({ nodes, edges: [] })

    const maplibreOp = getOp('/maplibre') as MaplibreBasemapOp

    expect(typeof maplibreOp.inputs.mapStyle.value).toBe('string')
    expect(maplibreOp.inputs.mapStyle.value).toBe('https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json')

    const result = maplibreOp.execute({
      mapStyle: maplibreOp.inputs.mapStyle.value,
      projection: 'mercator',
      viewState: { latitude: 37, longitude: -122, zoom: 10, pitch: 0, bearing: 0 },
      sky: { enabled: false, skyColor: '#88C6FC', horizonColor: '#ffffff', skyHorizonBlend: 0.8, atmosphereBlend: 0.5 },
      light: { anchor: 'viewport', azimuthal: 210, polar: 30 },
    })

    expect(typeof result.maplibre.mapStyle).toBe('string')
    expect(result.maplibre.mapStyle).toBe('https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json')
  })

  it('rejects invalid types (prevents validation errors)', () => {
    // Verify that invalid types are rejected by the schema
    const nodes: ReactFlowNode<{ inputs: Record<string, unknown> }>[] = [
      {
        id: '/maplibre',
        type: 'MaplibreBasemapOp',
        position: { x: 0, y: 0 },
        data: {
          inputs: {
            mapStyle: '',
            viewState: { latitude: 0, longitude: 0, zoom: 1, pitch: 0, bearing: 0 }
          }
        },
      },
    ]

    transformGraph({ nodes, edges: [] })

    const maplibreOp = getOp('/maplibre') as MaplibreBasemapOp

    // Try to set an invalid type (number)
    const initialValue = maplibreOp.inputs.mapStyle.value
    maplibreOp.inputs.mapStyle.setValue(123 as unknown as string)

    // Value should remain unchanged (validation failure)
    expect(maplibreOp.inputs.mapStyle.value).toBe(initialValue)
  })
})
