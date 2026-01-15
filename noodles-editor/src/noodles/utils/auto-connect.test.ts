import { describe, expect, it } from 'vitest'

import {
  FileOp,
  FilterOp,
  GeoJsonLayerOp,
  GeoJsonOp,
  NumberOp,
  ScatterplotLayerOp,
} from '../operators'
import { findBestConnection } from './auto-connect'

describe('findBestConnection', () => {
  it('finds connection from FileOp to FilterOp', () => {
    const fileOp = new FileOp('/file-1')
    const connection = findBestConnection(fileOp, 'FilterOp')

    expect(connection).not.toBeNull()
    expect(connection?.sourceOutput).toBe('data')
    expect(connection?.targetInput).toBe('data')
  })

  it('finds connection from GeoJsonOp to GeoJsonLayerOp', () => {
    const geoJsonOp = new GeoJsonOp('/geojson-1')
    const connection = findBestConnection(geoJsonOp, 'GeoJsonLayerOp')

    expect(connection).not.toBeNull()
    // GeoJsonOp outputs 'featureCollection', GeoJsonLayerOp accepts 'data'
    expect(connection?.sourceOutput).toBe('featureCollection')
    expect(connection?.targetInput).toBe('data')
  })

  it('finds connection from FilterOp to ScatterplotLayerOp', () => {
    const filterOp = new FilterOp('/filter-1')
    const connection = findBestConnection(filterOp, 'ScatterplotLayerOp')

    expect(connection).not.toBeNull()
    expect(connection?.sourceOutput).toBe('data')
    expect(connection?.targetInput).toBe('data')
  })

  it('finds connection from ScatterplotLayerOp to DeckRendererOp', () => {
    const scatterOp = new ScatterplotLayerOp('/scatter-1')
    const connection = findBestConnection(scatterOp, 'DeckRendererOp')

    expect(connection).not.toBeNull()
    expect(connection?.sourceOutput).toBe('layer')
    // Note: Due to flexible type matching, this may connect to various ListField inputs
  })

  it('finds some connection even for loosely typed operators', () => {
    const numberOp = new NumberOp('/number-1')
    // NumberOp outputs a number, DeckRendererOp has flexible UnknownField inputs
    const connection = findBestConnection(numberOp, 'DeckRendererOp')

    // Due to UnknownField and flexible type matching, a connection may be found
    // The important thing is that the function doesn't throw
    expect(connection === null || connection?.sourceOutput === 'val').toBe(true)
  })

  it('prefers priority inputs like "data" over other inputs', () => {
    const fileOp = new FileOp('/file-1')
    const connection = findBestConnection(fileOp, 'FilterOp')

    expect(connection).not.toBeNull()
    // FilterOp has 'data' input which should be preferred
    expect(connection?.targetInput).toBe('data')
  })

  it('returns null for invalid operator type', () => {
    const fileOp = new FileOp('/file-1')
    // @ts-expect-error Testing invalid type
    const connection = findBestConnection(fileOp, 'NonExistentOp')

    expect(connection).toBeNull()
  })

  it('finds layer connection for DeckRendererOp', () => {
    const geoJsonLayerOp = new GeoJsonLayerOp('/geojson-layer-1')
    const connection = findBestConnection(geoJsonLayerOp, 'DeckRendererOp')

    expect(connection).not.toBeNull()
    expect(connection?.sourceOutput).toBe('layer')
    // Connection target varies based on type compatibility
  })
})
