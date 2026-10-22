import { describe, expect, it } from 'vitest'
import { deckRenderingDefaults, mapRenderingDefaults } from './rendering-defaults'

describe('rendering defaults', () => {
  it('enables antialiasing and frame capture through MapLibre canvas context attributes', () => {
    expect(mapRenderingDefaults.canvasContextAttributes).toMatchObject({
      antialias: true,
      preserveDrawingBuffer: true,
    })
    expect(mapRenderingDefaults).not.toHaveProperty('antialias')
    expect(mapRenderingDefaults).not.toHaveProperty('preserveDrawingBuffer')
  })

  it('preserves the existing pixel ratio default for Deck rendering', () => {
    expect(deckRenderingDefaults).toHaveProperty('useDevicePixels', false)
  })
})
