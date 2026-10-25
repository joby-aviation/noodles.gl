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
