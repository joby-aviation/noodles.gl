import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CanvasFrameReader } from './capture-canvas-frame'

// Frames come from the compositor, on the real clock
beforeEach(() => {
  vi.useRealTimers()
})
afterEach(() => {
  vi.useFakeTimers()
  document.body.replaceChildren()
})

const settle = () => new Promise(resolve => setTimeout(resolve, 50))

it('reads the scene drawn when each frame is ready, not an earlier paint', async () => {
  // A WebGL canvas without preserveDrawingBuffer, like deck.gl's and MapLibre's
  const canvas = document.createElement('canvas')
  canvas.width = 16
  canvas.height = 16
  document.body.appendChild(canvas)
  const gl = canvas.getContext('webgl2')!
  let scene: [number, number, number] = [0, 0, 0]
  const redraw = () => {
    gl.clearColor(scene[0] / 255, scene[1] / 255, scene[2] / 255, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }
  const frames = new CanvasFrameReader(canvas, redraw)
  const pixel = new OffscreenCanvas(16, 16).getContext('2d')!

  try {
    for (const next of [
      [255, 0, 0],
      [0, 0, 255],
      [0, 255, 0],
    ] as const) {
      // As in an export: the previous scene is redrawn, then the next one is ready
      redraw()
      await settle()
      scene = [...next]
      const { value: frame } = await frames.read()
      pixel.drawImage(frame!, 0, 0)
      frame!.close()
      expect(Array.from(pixel.getImageData(8, 8, 1, 1).data)).toEqual([...next, 255])
    }
  } finally {
    frames.stop()
  }
})
