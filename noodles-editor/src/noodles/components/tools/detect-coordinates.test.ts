import { describe, expect, it } from 'vitest'
import cities from './__fixtures__/csv-drop/cities-lat-lng.csv?raw'
import earthquakes from './__fixtures__/csv-drop/earthquakes-latitude-longitude.csv?raw'
import landmarks from './__fixtures__/csv-drop/landmarks-wkt.csv?raw'
import sales from './__fixtures__/csv-drop/sales-no-coordinates.csv?raw'
import stations from './__fixtures__/csv-drop/stations-x-y.csv?raw'
import {
  type CoordinateDetection,
  columnTokens,
  describeDetection,
  detectCoordinates,
  detectFileCoordinates,
  detectGeoJsonBounds,
  detectSizeColumn,
  hasCoordinates,
  parseTabularRows,
  type Row,
  rowCountBucket,
  viewStateForBounds,
} from './detect-coordinates'

// Build rows from [header, ...values] so each case reads like a small table
function table(header: string[], ...values: unknown[][]) {
  const rows = values.map(v => Object.fromEntries(header.map((h, i) => [h, v[i]])) as Row)
  return { columns: header, rows }
}

function detect(header: string[], ...values: unknown[][]) {
  const { columns, rows } = table(header, ...values)
  return detectCoordinates(columns, rows)
}

function expectLatLng(detection: CoordinateDetection, latColumn: string, lngColumn: string) {
  expect(detection.kind).toBe('lat_lng')
  if (detection.kind !== 'lat_lng') return
  expect(detection.latColumn).toBe(latColumn)
  expect(detection.lngColumn).toBe(lngColumn)
}

describe('columnTokens', () => {
  it('splits on separators and camelCase', () => {
    expect(columnTokens('decimalLatitude')).toEqual(['decimal', 'latitude'])
    expect(columnTokens('LAT_DD')).toEqual(['lat', 'dd'])
    expect(columnTokens('Latitude (WGS84)')).toEqual(['latitude', 'wgs84'])
    expect(columnTokens('pickup-longitude')).toEqual(['pickup', 'longitude'])
  })
})

describe('detectCoordinates: column names', () => {
  it.each([
    ['lat', 'lng'],
    ['lat', 'lon'],
    ['lat', 'long'],
    ['latitude', 'longitude'],
    ['Latitude', 'Longitude'],
    ['LATITUDE', 'LONGITUDE'],
    ['LAT', 'LON'],
    ['y', 'x'],
    ['Y', 'X'],
    ['decimalLatitude', 'decimalLongitude'],
    ['LAT_DD', 'LON_DD'],
    ['lat_deg', 'lng_deg'],
    ['Latitude (WGS84)', 'Longitude (WGS84)'],
    ['gps_lat', 'gps_lng'],
    ['ycoord', 'xcoord'],
    ['POINT_Y', 'POINT_X'],
    ['pickup_latitude', 'pickup_longitude'],
    ['start_lat', 'start_lng'],
  ])('finds %s / %s', (lat, lng) => {
    expectLatLng(detect(['name', lat, lng], ['a', 40.7, -74], ['b', 51.5, -0.12]), lat, lng)
  })

  it('does not depend on column order', () => {
    expectLatLng(detect(['lng', 'name', 'lat'], [-74, 'a', 40.7]), 'lat', 'lng')
  })

  it('prefers plain names over prefixed ones', () => {
    expectLatLng(detect(['start_lat', 'start_lng', 'lat', 'lng'], [1, 2, 40.7, -74]), 'lat', 'lng')
  })

  it('pairs columns that share a prefix', () => {
    const detection = detect(
      ['pickup_lat', 'dropoff_lat', 'dropoff_lng', 'pickup_lng'],
      [40.7, 40.8, -73.9, -74]
    )
    expectLatLng(detection, 'pickup_lat', 'pickup_lng')
  })

  it('pairs latitude with longitude before x / y', () => {
    expectLatLng(detect(['x', 'y', 'lat', 'lng'], [1, 2, 40.7, -74]), 'lat', 'lng')
  })

  it('ignores names that only contain the letters', () => {
    expect(detect(['year', 'max', 'latency'], [2020, 3, 12]).kind).toBe('none')
  })

  it('skips a combined lat_long column', () => {
    expect(detect(['lat_long'], ['40.7,-74'])).toEqual({
      kind: 'none',
      reason: 'no_columns',
      rowCount: 1,
    })
  })
})

describe('detectCoordinates: value checks', () => {
  it('rejects projected x / y values', () => {
    expect(detect(['x', 'y'], [583000, 4507000], [584000, 4508000])).toEqual({
      kind: 'none',
      reason: 'out_of_range',
      rowCount: 2,
    })
  })

  it('rejects latitude outside -90..90', () => {
    expect(detect(['lat', 'lng'], [120, 10], [130, 20]).kind).toBe('none')
  })

  it('falls through to the next pair when the first is out of range', () => {
    expectLatLng(detect(['y', 'x', 'lat', 'lng'], [4507000, 583000, 40.7, -74]), 'lat', 'lng')
  })

  it('ignores empty cells and tolerates a few bad rows', () => {
    const values: unknown[][] = Array.from({ length: 20 }, (_, i) => [40 + i / 100, -74])
    values.push([null, null], ['', ''], [40, null])
    values.push(['n/a', -74])
    const detection = detect(['lat', 'lng'], ...values)
    expectLatLng(detection, 'lat', 'lng')
    expect(detection.kind === 'lat_lng' && detection.rowCount).toBe(20)
  })

  it('rejects a column that is mostly not numbers', () => {
    expect(detect(['lat', 'lng'], ['north', -74], ['south', -73], [40, -74]).kind).toBe('none')
  })

  it('reads numbers stored as strings', () => {
    expectLatLng(detect(['lat', 'lng'], ['40.7', ' -74.0 ']), 'lat', 'lng')
  })

  it('computes bounds from valid rows only', () => {
    const detection = detect(['lat', 'lng'], [10, 20], [-5, 30], [null, 99])
    expect(detection.kind === 'lat_lng' && detection.bounds).toEqual({
      west: 20,
      east: 30,
      south: -5,
      north: 10,
    })
  })

  it('reports empty input', () => {
    expect(detectCoordinates(['lat', 'lng'], [])).toEqual({
      kind: 'none',
      reason: 'no_rows',
      rowCount: 0,
    })
  })

  it('reports tables with no coordinate columns', () => {
    expect(detect(['region', 'units'], ['North', 3])).toEqual({
      kind: 'none',
      reason: 'no_columns',
      rowCount: 1,
    })
  })
})

describe('detectCoordinates: geometry columns', () => {
  it('reads WKT points', () => {
    const detection = detect(
      ['name', 'geom'],
      ['a', 'POINT (-122.4 37.8)'],
      ['b', 'POINT (-122 38)']
    )
    expect(detection).toMatchObject({
      kind: 'geometry',
      column: 'geom',
      encoding: 'wkt',
      pointsOnly: true,
      rowCount: 2,
      bounds: { west: -122.4, east: -122, south: 37.8, north: 38 },
    })
  })

  it('flags lines and polygons so they go to a GeoJsonLayer', () => {
    const detection = detect(['shape'], ['POLYGON ((0 0, 1 0, 1 1, 0 0))'], ['POINT (2 2)'])
    expect(detection).toMatchObject({ kind: 'geometry', pointsOnly: false, rowCount: 2 })
    expect(detection.kind === 'geometry' && detection.bounds).toEqual({
      west: 0,
      east: 2,
      south: 0,
      north: 2,
    })
  })

  it('reads GeoJSON strings and objects', () => {
    expect(detect(['geometry'], ['{"type":"Point","coordinates":[1,2]}'])).toMatchObject({
      kind: 'geometry',
      encoding: 'geojson_string',
    })
    expect(detect(['geometry'], [{ type: 'Point', coordinates: [1, 2] }])).toMatchObject({
      kind: 'geometry',
      encoding: 'geojson_object',
    })
  })

  it('finds a geometry column whatever its name', () => {
    expect(detect(['name', 'where'], ['a', 'POINT (1 2)'])).toMatchObject({
      kind: 'geometry',
      column: 'where',
    })
  })

  it('rejects geometries in projected coordinates', () => {
    expect(detect(['geom'], ['POINT (583000 4507000)']).kind).toBe('none')
  })

  it('prefers lat / lng columns over a geometry column', () => {
    expectLatLng(detect(['geom', 'lat', 'lng'], ['POINT (1 2)', 40, -74]), 'lat', 'lng')
  })

  it('does not treat plain text as WKT', () => {
    expect(detect(['city'], ['Tokyo'], ['Paris']).kind).toBe('none')
  })
})

describe('detectSizeColumn', () => {
  const rows = [
    { id: 1, year: 2001, Magnitude: 2.5, population: 10, docks: 5 },
    { id: 2, year: 2002, Magnitude: 4.1, population: 30, docks: 9 },
  ]
  const columns = Object.keys(rows[0])

  it('picks the most obvious numeric column', () => {
    expect(detectSizeColumn(columns, rows)).toEqual({ column: 'Magnitude', min: 2.5, max: 4.1 })
    expect(detectSizeColumn(['population', 'docks'], rows)).toEqual({
      column: 'population',
      min: 10,
      max: 30,
    })
  })

  it('keeps defaults when no column is obvious', () => {
    expect(detectSizeColumn(['id', 'year', 'docks'], rows)).toBeUndefined()
  })

  it('needs numbers that vary', () => {
    expect(detectSizeColumn(['count'], [{ count: 3 }, { count: 3 }])).toBeUndefined()
    expect(detectSizeColumn(['value'], [{ value: 'high' }, { value: 'low' }])).toBeUndefined()
  })

  it('skips id-like and excluded columns', () => {
    expect(detectSizeColumn(['value_id'], [{ value_id: 1 }, { value_id: 2 }])).toBeUndefined()
    expect(detectSizeColumn(columns, rows, ['Magnitude'])?.column).toBe('population')
  })
})

describe('parseTabularRows', () => {
  it('parses CSV with autoType like FileOp', () => {
    const result = parseTabularRows('name,lat\nNYC,40.7\n', 'csv')
    expect(result?.columns).toEqual(['name', 'lat'])
    expect([...(result?.rows ?? [])]).toEqual([{ name: 'NYC', lat: 40.7 }])
  })

  it('parses TSV with autoType like FileOp', () => {
    const result = parseTabularRows('name\tlat\tlng\nNYC, NY\t40.7\t-74\n', 'tsv')
    expect(result?.columns).toEqual(['name', 'lat', 'lng'])
    expect([...(result?.rows ?? [])]).toEqual([{ name: 'NYC, NY', lat: 40.7, lng: -74 }])
  })

  it('parses a JSON array of objects', () => {
    expect(parseTabularRows('[{"a":1},{"b":2}]', 'json')).toEqual({
      columns: ['a', 'b'],
      rows: [{ a: 1 }, { b: 2 }],
    })
  })

  it('returns null for anything that is not a table', () => {
    expect(parseTabularRows('{"a":1}', 'json')).toBeNull()
    expect(parseTabularRows('[1, 2]', 'json')).toBeNull()
    expect(parseTabularRows('not json', 'json')).toBeNull()
  })
})

describe('detectGeoJsonBounds', () => {
  const point = (lng: number, lat: number) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lng, lat] },
    properties: {},
  })

  it('reads FeatureCollections, Features and bare geometries', () => {
    expect(
      detectGeoJsonBounds({ type: 'FeatureCollection', features: [point(1, 2), point(3, 4)] })
    ).toEqual({ kind: 'geojson', rowCount: 2, bounds: { west: 1, east: 3, south: 2, north: 4 } })
    expect(detectGeoJsonBounds(point(1, 2))).toMatchObject({ kind: 'geojson', rowCount: 1 })
    expect(detectGeoJsonBounds({ type: 'Point', coordinates: [1, 2] })).toMatchObject({
      kind: 'geojson',
    })
  })

  it('reports empty or projected collections', () => {
    expect(detectGeoJsonBounds({ type: 'FeatureCollection', features: [] }).kind).toBe('none')
    expect(detectGeoJsonBounds(point(583000, 4507000))).toMatchObject({
      kind: 'none',
      reason: 'out_of_range',
    })
    expect(detectGeoJsonBounds(null).kind).toBe('none')
  })
})

describe('viewStateForBounds', () => {
  const size = { width: 1000, height: 600 }

  it('centers on the bounds', () => {
    const view = viewStateForBounds({ west: -10, east: 10, south: -5, north: 5 }, size)
    expect(view.longitude).toBeCloseTo(0)
    expect(view.latitude).toBeCloseTo(0)
    expect(view.zoom).toBeGreaterThan(2)
    expect(view.zoom).toBeLessThan(6)
  })

  it('gives a finite, capped zoom for a single point', () => {
    const view = viewStateForBounds({ west: 2.35, east: 2.35, south: 48.85, north: 48.85 }, size)
    expect(view.longitude).toBeCloseTo(2.35)
    expect(view.latitude).toBeCloseTo(48.85)
    expect(Number.isFinite(view.zoom)).toBe(true)
    expect(view.zoom).toBeLessThanOrEqual(14)
  })

  it('zooms far out for world-wide data and survives tiny maps', () => {
    const world = { west: -180, east: 180, south: -90, north: 90 }
    expect(viewStateForBounds(world, size).zoom).toBeLessThan(2)
    expect(Number.isFinite(viewStateForBounds(world, { width: 0, height: 0 }).zoom)).toBe(true)
  })
})

describe('rowCountBucket', () => {
  it('buckets counts without exposing them', () => {
    expect([0, 1, 99, 100, 999, 1000, 9999, 10_000, 100_000].map(rowCountBucket)).toEqual([
      '0',
      '1-99',
      '1-99',
      '100-999',
      '100-999',
      '1k-10k',
      '1k-10k',
      '10k-100k',
      '100k+',
    ])
  })
})

describe('describeDetection', () => {
  it('names the columns and counts', () => {
    const detection = detect(['Latitude', 'Longitude'], [40, -74], [41, -73])
    expect(describeDetection(detection)).toBe('Mapped 2 points from Latitude and Longitude')
    expect(describeDetection(detection, 'found')).toBe('Found 2 points in Latitude and Longitude')
    expect(describeDetection(detect(['geom'], ['POINT (1 2)']))).toBe('Mapped 1 point from geom')
    // Columns are listed in file order
    expect(describeDetection(detect(['x', 'y'], [1, 2]))).toBe('Mapped 1 point from x and y')
  })

  it('says why nothing was mapped', () => {
    expect(describeDetection(detect(['a'], [1]))).toBe(
      'No latitude/longitude or geometry column found'
    )
    expect(describeDetection(detect(['x', 'y'], [583000, 4507000]))).toMatch(/not longitude/)
    expect(describeDetection(detectCoordinates([], []))).toBe('The file has no rows to map')
  })
})

describe('detectFileCoordinates on sample files', () => {
  it('clean lat / lng with a population column', () => {
    const detection = detectFileCoordinates('csv', cities)
    expect(detection).toMatchObject({
      kind: 'lat_lng',
      latColumn: 'lat',
      lngColumn: 'lng',
      rowCount: 24,
      sizeColumn: { column: 'population' },
    })
  })

  it('Latitude / Longitude headers with a Magnitude column', () => {
    const detection = detectFileCoordinates('csv', earthquakes)
    expect(detection).toMatchObject({
      kind: 'lat_lng',
      latColumn: 'Latitude',
      lngColumn: 'Longitude',
      sizeColumn: { column: 'Magnitude' },
    })
    if (detection?.kind !== 'lat_lng') return
    // California
    expect(detection.bounds.west).toBeGreaterThan(-126)
    expect(detection.bounds.east).toBeLessThan(-113)
    expect(detection.bounds.south).toBeGreaterThan(31)
    expect(detection.bounds.north).toBeLessThan(43)
  })

  it('x / y columns, with nothing obvious to size by', () => {
    const detection = detectFileCoordinates('csv', stations)
    expect(detection).toMatchObject({ kind: 'lat_lng', latColumn: 'y', lngColumn: 'x' })
    expect(detection?.kind === 'lat_lng' && detection.sizeColumn).toBeUndefined()
  })

  it('a WKT column', () => {
    expect(detectFileCoordinates('csv', landmarks)).toMatchObject({
      kind: 'geometry',
      column: 'WKT',
      encoding: 'wkt',
      pointsOnly: true,
      rowCount: 6,
    })
  })

  it('the same cities as a TSV', () => {
    const detection = detectFileCoordinates('tsv', cities.replaceAll(',', '\t'))
    expect(detection).toMatchObject({
      kind: 'lat_lng',
      latColumn: 'lat',
      lngColumn: 'lng',
      rowCount: 24,
      sizeColumn: { column: 'population' },
    })
  })

  it('a CSV with no coordinates', () => {
    const detection = detectFileCoordinates('csv', sales)
    expect(detection).toEqual({ kind: 'none', reason: 'no_columns', rowCount: 8 })
    expect(hasCoordinates(detection)).toBe(false)
  })

  it('skips formats it cannot read as a table', () => {
    expect(detectFileCoordinates('shapefile', '')).toBeUndefined()
    expect(detectFileCoordinates('geojson', 'not json')).toBeUndefined()
    expect(detectFileCoordinates('json', '{"not":"a table"}')).toBeUndefined()
  })
})
