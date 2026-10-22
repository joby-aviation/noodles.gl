import { decodeRgba, EXRReader, SampleType } from 'exrjs'
import { describe, expect, it } from 'vitest'
import { encodeExrFrame, loadExrEncoder, rgba8ToLinearPremultiplied } from './exr-export'

describe('rgba8ToLinearPremultiplied', () => {
  it('decodes the sRGB curve at black, mid gray, and white', () => {
    const out = rgba8ToLinearPremultiplied(new Uint8Array([0, 128, 255, 255]))

    expect(out[0]).toBe(0)
    expect(out[1]).toBeCloseTo(0.2158605, 6)
    expect(out[2]).toBe(1)
    expect(out[3]).toBe(1)
  })

  it('uses the linear segment of the curve for dark values', () => {
    const out = rgba8ToLinearPremultiplied(new Uint8Array([10, 10, 10, 255]))

    expect(out[0]).toBeCloseTo(10 / 255 / 12.92, 8)
  })

  it('premultiplies color by alpha', () => {
    const out = rgba8ToLinearPremultiplied(new Uint8Array([255, 255, 255, 51, 255, 0, 0, 0]))

    expect(Array.from(out)).toEqual([0.2, 0.2, 0.2, 0.2, 0, 0, 0, 0].map(Math.fround))
  })
})

describe('encodeExrFrame', () => {
  it('writes a half-float RGBA image that decodes to linear premultiplied color', async () => {
    const width = 3
    const height = 2
    const data = new Uint8ClampedArray([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 128, 128, 128, 255, 255, 255, 255, 128, 0, 0,
      0, 0,
    ])

    const bytes = await encodeExrFrame({ data, width, height })
    const decoded = decodeRgba(bytes.buffer)

    expect(decoded.width).toBe(width)
    expect(decoded.height).toBe(height)
    const expected = rgba8ToLinearPremultiplied(data)
    for (let i = 0; i < expected.length; i++) {
      // Half floats carry about 3 significant digits
      expect(decoded.pixels[i]).toBeCloseTo(expected[i], 3)
    }

    const reader = new EXRReader(bytes.buffer)
    expect(reader.getChannelNames()).toEqual(['A', 'B', 'G', 'R'])
    expect(
      reader.getHeader().channels.list.map((c: { sampleType: string }) => c.sampleType)
    ).toEqual(Array(4).fill(SampleType.F16))
  })

  it('loads the encoder once', async () => {
    expect(loadExrEncoder()).toBe(loadExrEncoder())
  })
})
