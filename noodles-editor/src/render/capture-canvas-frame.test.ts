import { expect, it, vi } from 'vitest'
import { captureCanvasFrame } from './capture-canvas-frame'

it('captures successive frames from an otherwise idle canvas', async () => {
  vi.useRealTimers()
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const context = canvas.getContext('2d')!
  const track = canvas.captureStream(0).getVideoTracks()[0]
  const reader = new MediaStreamTrackProcessor({ track }).readable.getReader()
  const captured = new OffscreenCanvas(64, 64).getContext('2d')!
  try {
    for (const [color, rgb] of [
      ['red', [255, 0, 0]],
      ['blue', [0, 0, 255]],
    ] as const) {
      const { value: frame } = await captureCanvasFrame(track, reader, () => {
        context.fillStyle = color
        context.fillRect(0, 0, 64, 64)
      })
      expect(frame).toBeDefined()
      expect(frame!.displayWidth).toBe(64)
      expect(frame!.displayHeight).toBe(64)
      captured.drawImage(frame!, 0, 0)
      expect(Array.from(captured.getImageData(32, 32, 1, 1).data).slice(0, 3)).toEqual(rgb)
      frame!.close()
    }
  } finally {
    track.stop()
    reader.releaseLock()
    vi.useFakeTimers()
  }
})
