// Deck operators' build: the deck.gl description each one hands the engine
import { describe, expect, it } from 'vitest'
import { DECK_OP_INDEX } from './deck-ops'

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
