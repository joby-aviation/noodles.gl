// Deck operators' build: the deck.gl description each one hands the engine
import { describe, expect, it } from 'vitest'
import { asCamera, DECK_OP_INDEX } from './deck-ops'

const env = { surface: { width: 800, height: 600 } }

describe('path-style', () => {
  const build = (params: Record<string, unknown>) =>
    DECK_OP_INDEX.get('path-style')?.build(
      { dash: true, highPrecisionDash: false, offset: false, dashMode: 'segment', ...params },
      'style',
      env
    ) as { extension: Record<string, unknown> }

  it('draws solid lines when dash is off: deck.gl dashes whenever dashMode is set', () => {
    const { extension } = build({ dash: false, offset: true })
    expect(extension).toMatchObject({ type: 'PathStyleExtension', dash: false, offset: true })
    expect(extension).not.toHaveProperty('dashMode')
  })

  it('passes the dash mode with dash on, whole-path for high precision', () => {
    expect(build({}).extension.dashMode).toBe('segment')
    expect(build({ highPrecisionDash: true }).extension.dashMode).toBe('path')
  })
})

describe('tile-3d', () => {
  it('asks for a tileset URL with the Generic provider, which sends no credentials', async () => {
    const build = DECK_OP_INDEX.get('tile-3d')?.build(
      { provider: 'Generic', tilesetUrl: '' },
      'tiles',
      env
    )
    await expect(build).rejects.toThrow('set Tileset URL')
  })

  it('loads a Generic tileset from its URL', async () => {
    const built = (await DECK_OP_INDEX.get('tile-3d')?.build(
      { provider: 'Generic', tilesetUrl: 'https://example.com/tileset.json' },
      'tiles',
      env
    )) as { data: string; loadOptions: unknown }
    expect(built.data).toBe('https://example.com/tileset.json')
    expect(built.loadOptions).toBeNull()
  })
})

describe('pmtiles', () => {
  const source = (params: Record<string, unknown>) =>
    DECK_OP_INDEX.get('pmtiles')?.build(
      { url: 'https://x/t.pmtiles', minZoom: 0, maxZoom: 14, ...params },
      'tiles',
      env
    ) as Record<string, unknown>

  it('is a vector source by default, with its source layer', () => {
    expect(source({ sourceLayer: 'roads' })).toMatchObject({ type: 'vector', sourceLayer: 'roads' })
  })

  it('is a raster source when asked, which has no source layer', () => {
    const raster = source({ tileType: 'raster', sourceLayer: 'roads' })
    expect(raster.type).toBe('raster')
    expect(raster).not.toHaveProperty('sourceLayer')
  })
})

describe('switch-value', () => {
  const sf = { longitude: -122.4, latitude: 37.8, zoom: 10 }
  const ny = { longitude: -74, latitude: 40.7, zoom: 12 }
  const build = (index: number, blend = false, values: unknown[] = [sf, ny]) =>
    DECK_OP_INDEX.get('switch-value')?.build({ values, index, blend }, 'shots', env)

  it('picks the value below the index, as the Noodles SwitchOp did, clamped to the inputs', () => {
    expect(build(0)).toBe(sf)
    expect(build(0.9)).toBe(sf)
    expect(build(1)).toBe(ny)
    expect(build(7)).toBe(ny)
    expect(build(0, false, [])).toBeUndefined()
  })

  it('blends the two either side of a decimal index', () => {
    expect(build(0.5, true)).toEqual({ longitude: -98.2, latitude: 39.25, zoom: 11 })
    expect(build(1, true)).toBe(ny)
  })
})

describe('camera inputs', () => {
  it('read a camera as it is, a point as its center, and bounds as the camera that fits them', () => {
    expect(asCamera({ longitude: 1, latitude: 2, zoom: 3 }, env.surface)).toEqual({
      longitude: 1,
      latitude: 2,
      zoom: 3,
    })
    expect(asCamera({ lng: 1, lat: 2 }, env.surface)).toEqual({ longitude: 1, latitude: 2 })
    expect(asCamera([1, 2], env.surface)).toEqual({ longitude: 1, latitude: 2 })
    expect(
      asCamera({ type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] } }, env.surface)
    ).toEqual({ longitude: 1, latitude: 2 })
    const fit = asCamera(
      [
        [-10, -10],
        [10, 10],
      ],
      env.surface
    )
    expect(fit.longitude).toBeCloseTo(0)
    expect(fit.latitude).toBeCloseTo(0)
    expect(fit.zoom).toBeGreaterThan(0)
    expect(asCamera('nowhere', env.surface)).toEqual({})
    expect(asCamera(undefined, env.surface)).toEqual({})
  })

  it('let a View State take the fields a wired camera has, and keep its own for the rest', () => {
    const build = (from: unknown) =>
      DECK_OP_INDEX.get('view-state')?.build(
        { longitude: 0, latitude: 0, zoom: 12, pitch: 45, bearing: 10, from },
        'camera',
        env
      )
    expect(build(null)).toEqual({ longitude: 0, latitude: 0, zoom: 12, pitch: 45, bearing: 10 })
    expect(build({ lng: 5, lat: 6 })).toEqual({
      longitude: 5,
      latitude: 6,
      zoom: 12,
      pitch: 45,
      bearing: 10,
    })
    const fitted = build([
      [-10, -10],
      [10, 10],
    ]) as Record<string, number>
    expect(fitted).toMatchObject({ pitch: 45, bearing: 10 })
    expect(fitted.zoom).not.toBe(12)
    expect(fitted.longitude).toBeCloseTo(0)
  })
})

describe('globe-view', () => {
  it('passes its resolution and a camera with bearing and pitch to deck', () => {
    const def = DECK_OP_INDEX.get('globe-view')
    expect(def?.def.params.find(p => p.name === 'resolution')?.default).toBe(10)
    const view = def?.build(
      {
        resolution: 4,
        viewState: { latitude: 10, longitude: 20, zoom: 3, bearing: 30, pitch: 45 },
      },
      'globe',
      env
    )
    expect(view).toMatchObject({
      type: 'GlobeView',
      id: 'globe',
      resolution: 4,
      viewState: { bearing: 30, pitch: 45 },
    })
  })
})
