import { afterEach, describe, expect, it, vi } from 'vitest'
import { calculateRenderSurfaceSize } from './render-surface-size'
import { captureScreenshot } from './renderer'

describe('render output resolution', () => {
  afterEach(() => vi.restoreAllMocks())

  it('writes a PNG with the source canvas pixel dimensions unchanged', async () => {
    const outputSize = calculateRenderSurfaceSize({ width: 320, height: 180 }, 2)
    const canvas = document.createElement('canvas')
    canvas.width = outputSize.width
    canvas.height = outputSize.height
    const context = canvas.getContext('2d')
    context?.fillRect(0, 0, canvas.width, canvas.height)
    let writtenBlob: Blob | undefined

    vi.spyOn(window, 'showSaveFilePicker').mockResolvedValue({
      getFile: async () => new File([], 'render.png', { type: 'image/png' }),
      createWritable: async () => ({
        write: async (blob: Blob) => {
          writtenBlob = blob
        },
        close: async () => {},
      }),
    } as unknown as FileSystemFileHandle)

    await captureScreenshot('render', () => canvas)

    expect(writtenBlob?.type).toBe('image/png')
    const image = await createImageBitmap(writtenBlob!)
    expect({ width: image.width, height: image.height }).toEqual(outputSize)
    image.close()
  })
})
