import { Deck } from '@deck.gl/core'
import { describe, expect, it, vi } from 'vitest'
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

  // Transparent video export reads the canvas's alpha. MapLibre always asks for an
  // alpha channel; this checks deck.gl's context has one too.
  it('gives the Deck canvas an alpha channel', async () => {
    vi.useRealTimers()
    const canvas = document.createElement('canvas')
    document.body.appendChild(canvas)
    let deck: Deck | undefined
    try {
      const gl = await new Promise<WebGL2RenderingContext>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Deck did not initialize')), 10000)
        deck = new Deck({
          ...deckRenderingDefaults,
          canvas,
          width: 16,
          height: 16,
          onWebGLInitialized: context => {
            clearTimeout(timeout)
            resolve(context as WebGL2RenderingContext)
          },
        })
      })
      expect(gl.getContextAttributes()?.alpha).toBe(true)
    } finally {
      deck?.finalize()
      canvas.remove()
      vi.useFakeTimers()
    }
  })
})
