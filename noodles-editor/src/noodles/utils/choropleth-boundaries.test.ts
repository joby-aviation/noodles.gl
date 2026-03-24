import type { FeatureCollection } from 'geojson'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearBoundaryCache,
  detectGeoKey,
  getBoundaries,
  joinDataToFeatures,
} from './choropleth-boundaries'

// Mock topojson-client so tests don't depend on its TopoJSON parsing internals
vi.mock('topojson-client', () => ({
  feature: vi.fn((_topology, object) => ({
    type: 'FeatureCollection',
    features: object.geometries.map(
      (g: { type: string; id?: number; properties?: Record<string, unknown> }) => ({
        type: 'Feature',
        id: g.id,
        properties: g.properties ?? {},
        geometry: { type: g.type, coordinates: [] },
      })
    ),
  })),
}))

// Mock fetch globally
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function makeFeatureCollection(features: object[]): FeatureCollection {
  return { type: 'FeatureCollection', features: features as FeatureCollection['features'] }
}

const US_STATES_TOPOJSON = {
  type: 'Topology',
  objects: {
    states: {
      type: 'GeometryCollection',
      geometries: [
        { type: 'Polygon', id: 6, properties: { name: 'California' } },
        { type: 'Polygon', id: 48, properties: { name: 'Texas' } },
        { type: 'Polygon', id: 36, properties: { name: 'New York' } },
      ],
    },
  },
  arcs: [],
}

const WORLD_COUNTRIES_TOPOJSON = {
  type: 'Topology',
  objects: {
    countries: {
      type: 'GeometryCollection',
      geometries: [
        { type: 'Polygon', id: 840, properties: {} },
        { type: 'Polygon', id: 276, properties: {} },
        { type: 'Polygon', id: 76, properties: {} },
      ],
    },
  },
  arcs: [],
}

beforeEach(() => {
  clearBoundaryCache()
  mockFetch.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('getBoundaries', () => {
  it('returns user-supplied boundaries when geography is custom', async () => {
    const userBoundaries = makeFeatureCollection([
      { type: 'Feature', properties: { name: 'Custom' }, geometry: null },
    ])
    const result = await getBoundaries('custom', userBoundaries)
    expect(result).toBe(userBoundaries)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns empty FeatureCollection when custom with no user boundaries', async () => {
    const result = await getBoundaries('custom')
    expect(result.features).toHaveLength(0)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('enriches US state features with fips and abbrev properties', async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve(US_STATES_TOPOJSON),
    })

    const result = await getBoundaries('us-states')
    const california = result.features.find(f => f.properties?.name === 'California')
    expect(california?.properties?.fips).toBe('06')
    expect(california?.properties?.abbrev).toBe('CA')
  })

  it('enriches world country features with iso2/iso3/name', async () => {
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve(WORLD_COUNTRIES_TOPOJSON),
    })

    const result = await getBoundaries('world-countries')
    const usa = result.features.find(f => f.properties?.iso2 === 'US')
    expect(usa?.properties?.iso3).toBe('USA')
    expect(usa?.properties?.name).toBe('United States')
  })

  it('caches boundary data after first fetch', async () => {
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve(US_STATES_TOPOJSON),
    })

    await getBoundaries('us-states')
    await getBoundaries('us-states')
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('fetches different geographies independently', async () => {
    mockFetch
      .mockResolvedValueOnce({ json: () => Promise.resolve(US_STATES_TOPOJSON) })
      .mockResolvedValueOnce({ json: () => Promise.resolve(WORLD_COUNTRIES_TOPOJSON) })

    await getBoundaries('us-states')
    await getBoundaries('world-countries')
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })
})

describe('detectGeoKey', () => {
  it('detects US state abbreviations', () => {
    const data = [{ state: 'CA' }, { state: 'TX' }, { state: 'NY' }, { state: 'FL' }]
    expect(detectGeoKey(data, 'state', 'us-states')).toBe('abbrev')
  })

  it('detects US state full names', () => {
    const data = [
      { state: 'California' },
      { state: 'Texas' },
      { state: 'New York' },
      { state: 'Florida' },
    ]
    expect(detectGeoKey(data, 'state', 'us-states')).toBe('name')
  })

  it('detects US state FIPS codes', () => {
    const data = [{ code: '06' }, { code: '48' }, { code: '36' }, { code: '12' }]
    expect(detectGeoKey(data, 'code', 'us-states')).toBe('fips')
  })

  it('handles unpadded FIPS codes', () => {
    const data = [{ code: '6' }, { code: '48' }, { code: '36' }, { code: '12' }]
    expect(detectGeoKey(data, 'code', 'us-states')).toBe('fips')
  })

  it('detects ISO alpha-2 country codes', () => {
    const data = [{ country: 'US' }, { country: 'DE' }, { country: 'GB' }, { country: 'FR' }]
    expect(detectGeoKey(data, 'country', 'world-countries')).toBe('iso2')
  })

  it('detects ISO alpha-3 country codes', () => {
    const data = [{ country: 'USA' }, { country: 'DEU' }, { country: 'GBR' }, { country: 'FRA' }]
    expect(detectGeoKey(data, 'country', 'world-countries')).toBe('iso3')
  })

  it('detects country names', () => {
    const data = [
      { country: 'United States' },
      { country: 'Germany' },
      { country: 'France' },
      { country: 'Japan' },
    ]
    expect(detectGeoKey(data, 'country', 'world-countries')).toBe('name')
  })

  it('detects Canadian province codes', () => {
    const data = [{ province: 'ON' }, { province: 'BC' }, { province: 'QC' }, { province: 'AB' }]
    expect(detectGeoKey(data, 'province', 'ca-provinces')).toBe('abbrev')
  })

  it('returns first candidate when no samples available', () => {
    const data: Record<string, unknown>[] = []
    // For us-states the first candidate in the list is 'abbrev'
    const result = detectGeoKey(data, 'state', 'us-states')
    expect(['abbrev', 'name', 'fips']).toContain(result)
  })
})

describe('joinDataToFeatures', () => {
  const usBoundaries = makeFeatureCollection([
    {
      type: 'Feature',
      id: 6,
      properties: { name: 'California', fips: '06', abbrev: 'CA' },
      geometry: null,
    },
    {
      type: 'Feature',
      id: 48,
      properties: { name: 'Texas', fips: '48', abbrev: 'TX' },
      geometry: null,
    },
    {
      type: 'Feature',
      id: 36,
      properties: { name: 'New York', fips: '36', abbrev: 'NY' },
      geometry: null,
    },
  ])

  it('joins data rows onto matching features by abbreviation', () => {
    const data = [
      { state: 'CA', unemployment: 5.2 },
      { state: 'TX', unemployment: 4.1 },
      { state: 'NY', unemployment: 6.3 },
    ]
    const result = joinDataToFeatures(usBoundaries, data, 'state', 'abbrev')
    const ca = result.features.find(f => f.properties?.abbrev === 'CA')
    expect(ca?.properties?.unemployment).toBe(5.2)
  })

  it('joins data rows onto matching features by name (case-insensitive)', () => {
    const data = [
      { state: 'california', unemployment: 5.2 },
      { state: 'texas', unemployment: 4.1 },
    ]
    const result = joinDataToFeatures(usBoundaries, data, 'state', 'name')
    const ca = result.features.find(f => f.properties?.name === 'California')
    expect(ca?.properties?.unemployment).toBe(5.2)
  })

  it('joins data rows by FIPS code, handling unpadded input', () => {
    const data = [
      { state_fips: '6', value: 100 },
      { state_fips: '48', value: 200 },
    ]
    const result = joinDataToFeatures(usBoundaries, data, 'state_fips', 'fips')
    // Find by name since data doesn't have a conflicting 'fips' property
    const ca = result.features.find(f => f.properties?.name === 'California')
    const tx = result.features.find(f => f.properties?.name === 'Texas')
    expect(ca?.properties?.value).toBe(100)
    expect(tx?.properties?.value).toBe(200)
  })

  it('preserves original feature properties for unmatched features', () => {
    const data = [{ state: 'CA', unemployment: 5.2 }]
    const result = joinDataToFeatures(usBoundaries, data, 'state', 'abbrev')
    const ny = result.features.find(f => f.properties?.abbrev === 'NY')
    expect(ny?.properties?.unemployment).toBeUndefined()
    expect(ny?.properties?.name).toBe('New York')
  })

  it('merges data properties onto existing feature properties', () => {
    const data = [{ state: 'CA', unemployment: 5.2, gdp: 3.6 }]
    const result = joinDataToFeatures(usBoundaries, data, 'state', 'abbrev')
    const ca = result.features.find(f => f.properties?.abbrev === 'CA')
    expect(ca?.properties?.name).toBe('California')
    expect(ca?.properties?.unemployment).toBe(5.2)
    expect(ca?.properties?.gdp).toBe(3.6)
  })

  it('handles null joinKey values gracefully', () => {
    const data = [
      { state: null, unemployment: 5.2 },
      { state: 'TX', unemployment: 4.1 },
    ]
    const result = joinDataToFeatures(usBoundaries, data, 'state', 'abbrev')
    expect(result.features).toHaveLength(3)
    const tx = result.features.find(f => f.properties?.abbrev === 'TX')
    expect(tx?.properties?.unemployment).toBe(4.1)
  })

  it('handles empty data array', () => {
    const result = joinDataToFeatures(usBoundaries, [], 'state', 'abbrev')
    expect(result.features).toHaveLength(3)
    for (const f of result.features) expect(f.properties?.unemployment).toBeUndefined()
  })

  it('joins world countries by ISO alpha-2 code', () => {
    const worldBoundaries = makeFeatureCollection([
      {
        type: 'Feature',
        id: 840,
        properties: { name: 'United States', iso2: 'US', iso3: 'USA' },
        geometry: null,
      },
      {
        type: 'Feature',
        id: 276,
        properties: { name: 'Germany', iso2: 'DE', iso3: 'DEU' },
        geometry: null,
      },
    ])
    const data = [
      { country: 'US', gdp: 21000 },
      { country: 'DE', gdp: 3800 },
    ]
    const result = joinDataToFeatures(worldBoundaries, data, 'country', 'iso2')
    const us = result.features.find(f => f.properties?.iso2 === 'US')
    expect(us?.properties?.gdp).toBe(21000)
  })

  it('resolves common country name aliases', () => {
    const worldBoundaries = makeFeatureCollection([
      {
        type: 'Feature',
        id: 840,
        properties: { name: 'United States', iso2: 'US', iso3: 'USA' },
        geometry: null,
      },
      {
        type: 'Feature',
        id: 826,
        properties: { name: 'United Kingdom', iso2: 'GB', iso3: 'GBR' },
        geometry: null,
      },
    ])
    const data = [
      { country: 'USA', gdp: 21000 },
      { country: 'UK', gdp: 2700 },
    ]
    // 'USA' is iso3 key
    const resultIso3 = joinDataToFeatures(worldBoundaries, data, 'country', 'iso3')
    expect(resultIso3.features.find(f => f.properties?.iso3 === 'USA')?.properties?.gdp).toBe(21000)
    // 'UK' is a name alias for 'United Kingdom' when using name geoKey
    const resultName = joinDataToFeatures(
      worldBoundaries,
      [{ country: 'uk', gdp: 2700 }],
      'country',
      'name'
    )
    expect(resultName.features.find(f => f.properties?.iso2 === 'GB')?.properties?.gdp).toBe(2700)
  })
})
