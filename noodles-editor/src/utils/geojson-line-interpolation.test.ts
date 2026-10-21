import * as turf from '@turf/turf'
import { describe, expect, it } from 'vitest'

import { LineInterpolationOp } from '../noodles/operators'
import { interpolateGeoJsonLines, type LineInterpolationMethod } from './geojson-line-interpolation'

const routeCoordinates = [
  [-97, 32.9],
  [-96.99, 32.9],
  [-96.99, 32.91],
  [-96.98, 32.91],
]

describe('interpolateGeoJsonLines', () => {
  it.each<LineInterpolationMethod>([
    'catmull-rom',
    'cardinal',
    'basis',
    'natural',
    'monotone-x',
    'monotone-y',
  ])('samples the %s curve without moving its endpoints', method => {
    const feature = turf.lineString(routeCoordinates, { name: 'route' })
    const result = interpolateGeoJsonLines(feature, { method, samplesPerSegment: 8 })

    expect(result).not.toBe(feature)
    expect(result.properties).toEqual({ name: 'route' })
    expect(result.geometry.coordinates.length).toBeGreaterThan(routeCoordinates.length)
    expect(result.geometry.coordinates[0]).toEqual(routeCoordinates[0])
    expect(result.geometry.coordinates.at(-1)).toEqual(routeCoordinates.at(-1))
    expect(feature.geometry.coordinates).toEqual(routeCoordinates)
  })

  it('keeps the exact input coordinates in linear mode', () => {
    const feature = turf.lineString(routeCoordinates)
    const result = interpolateGeoJsonLines(feature, { method: 'linear' })

    expect(result).toEqual(feature)
    expect(result).not.toBe(feature)
    expect(result.geometry.coordinates).not.toBe(feature.geometry.coordinates)
  })

  it('rounds a corner with a circular radius while preserving its straight legs', () => {
    const feature = turf.lineString(routeCoordinates.slice(0, 3))
    const result = interpolateGeoJsonLines(feature, {
      method: 'turn-radius',
      turnRadiusMeters: 250,
    })
    const coordinates = result.geometry.coordinates

    expect(coordinates[0]).toEqual(routeCoordinates[0])
    expect(coordinates.at(-1)).toEqual(routeCoordinates[2])
    expect(coordinates.length).toBeGreaterThan(5)
    expect(coordinates).not.toContainEqual(routeCoordinates[1])

    const firstArcPoint = coordinates[1]
    const lastArcPoint = coordinates.at(-2)!
    expect(firstArcPoint[1]).toBeCloseTo(routeCoordinates[1][1], 10)
    expect(lastArcPoint[0]).toBeCloseTo(routeCoordinates[1][0], 10)
    expect(turf.distance(firstArcPoint, routeCoordinates[1], { units: 'meters' })).toBeCloseTo(
      250,
      -1
    )
    expect(turf.distance(lastArcPoint, routeCoordinates[1], { units: 'meters' })).toBeCloseTo(
      250,
      -1
    )
  })

  it('uses zero turn radius as a true off state', () => {
    const feature = turf.lineString(routeCoordinates)
    const result = interpolateGeoJsonLines(feature, {
      method: 'turn-radius',
      turnRadiusMeters: 0,
    })

    expect(result).toEqual(feature)
  })

  it('limits large radii on short adjacent legs and produces finite coordinates', () => {
    const feature = turf.lineString([
      [0, 0],
      [0.001, 0],
      [0.001, 0.001],
      [0.002, 0.001],
    ])
    const result = interpolateGeoJsonLines(feature, {
      method: 'turn-radius',
      turnRadiusMeters: 100_000,
    })

    expect(result.geometry.coordinates.flat().every(Number.isFinite)).toBe(true)
    expect(result.geometry.coordinates[0]).toEqual([0, 0])
    expect(result.geometry.coordinates.at(-1)).toEqual([0.002, 0.001])
  })

  it('handles FeatureCollections, MultiLineStrings, and non-line geometry', () => {
    const line = turf.multiLineString([routeCoordinates.slice(0, 3), routeCoordinates.slice(1)])
    const point = turf.point([-97, 32.9], { label: 'unchanged' })
    const collection = turf.featureCollection([line, point] as GeoJSON.Feature[])
    const result = interpolateGeoJsonLines(collection, {
      method: 'catmull-rom',
      samplesPerSegment: 4,
    })

    expect(result.features[0].geometry.type).toBe('MultiLineString')
    if (result.features[0].geometry.type === 'MultiLineString') {
      expect(result.features[0].geometry.coordinates[0].length).toBeGreaterThan(3)
      expect(result.features[0].geometry.coordinates[1].length).toBeGreaterThan(3)
    }
    expect(result.features[1]).toEqual(point)
  })

  it('handles LineStrings nested in GeometryCollections', () => {
    const geometryCollection: GeoJSON.GeometryCollection = {
      type: 'GeometryCollection',
      geometries: [
        { type: 'LineString', coordinates: routeCoordinates.slice(0, 3) },
        { type: 'Point', coordinates: routeCoordinates[0] },
      ],
    }
    const result = interpolateGeoJsonLines(geometryCollection, {
      method: 'catmull-rom',
      samplesPerSegment: 4,
    })

    expect(result.geometries[0].type).toBe('LineString')
    if (result.geometries[0].type === 'LineString') {
      expect(result.geometries[0].coordinates.length).toBeGreaterThan(3)
    }
    expect(result.geometries[1]).toEqual(geometryCollection.geometries[1])
  })

  it.each<LineInterpolationMethod>([
    'catmull-rom',
    'turn-radius',
  ])('takes the short path across the antimeridian in %s mode', method => {
    const coordinates = [
      [179.98, 10],
      [-179.99, 10],
      [-179.99, 10.03],
    ]
    const result = interpolateGeoJsonLines(turf.lineString(coordinates), {
      method,
      samplesPerSegment: 8,
      turnRadiusMeters: 500,
    })

    expect(result.geometry.coordinates[0]).toEqual(coordinates[0])
    expect(result.geometry.coordinates.at(-1)).toEqual(coordinates.at(-1))
    expect(result.geometry.coordinates.every(point => Math.abs(point[0]) > 170)).toBe(true)
  })

  it('bounds unsafe numeric options supplied through the exported utility', () => {
    const result = interpolateGeoJsonLines(turf.lineString(routeCoordinates), {
      method: 'catmull-rom',
      samplesPerSegment: Infinity,
      alpha: Number.NaN,
      tension: Infinity,
      turnRadiusMeters: Infinity,
    })

    expect(result.geometry.coordinates.length).toBeGreaterThan(routeCoordinates.length)
    expect(result.geometry.coordinates.length).toBeLessThan(500)
    expect(result.geometry.coordinates.flat().every(Number.isFinite)).toBe(true)
  })

  it('interpolates extra coordinate dimensions across generated samples', () => {
    const feature = turf.lineString([
      [-97, 32.9, 100],
      [-96.99, 32.9, 200],
      [-96.99, 32.91, 300],
    ])
    const result = interpolateGeoJsonLines(feature, {
      method: 'catmull-rom',
      samplesPerSegment: 6,
    })

    expect(result.geometry.coordinates.every(position => position.length === 3)).toBe(true)
    expect(result.geometry.coordinates[0][2]).toBe(100)
    const interiorVertex = result.geometry.coordinates.find(
      position => Math.abs(position[0] - -96.99) < 1e-12 && Math.abs(position[1] - 32.9) < 1e-12
    )
    expect(interiorVertex?.[2]).toBe(200)
    expect(result.geometry.coordinates.at(-1)?.[2]).toBe(300)
  })
})

describe('LineInterpolationOp', () => {
  it('exposes line interpolation controls and executes GeoJSON input', () => {
    const op = new LineInterpolationOp('/line-interpolation-0')
    const feature = turf.lineString(routeCoordinates.slice(0, 3))

    expect(op.inputs.method.value).toBe('catmull-rom')
    expect(op.inputs.turnRadiusMeters.value).toBe(250)

    const result = op.execute({
      feature,
      method: 'turn-radius',
      samplesPerSegment: 12,
      alpha: 0.5,
      tension: 0,
      turnRadiusMeters: 100,
    } as never) as { feature: GeoJSON.Feature<GeoJSON.LineString> }

    expect(result.feature.geometry.coordinates.length).toBeGreaterThan(3)
  })
})
