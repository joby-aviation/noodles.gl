// OpenEXR frames for image-sequence export. exrjs (~21 KB gzipped) is loaded on first use
// so it stays out of the main bundle.

type Exrjs = typeof import('exrjs')

let exrjs: Promise<Exrjs> | undefined

export function loadExrEncoder(): Promise<Exrjs> {
  exrjs ??= import('exrjs').catch(error => {
    // Let a later export retry a failed chunk load
    exrjs = undefined
    throw error
  })
  return exrjs
}

// sRGB transfer curve, decoded once per 8-bit value
const SRGB_TO_LINEAR = Float32Array.from({ length: 256 }, (_, i) => {
  const c = i / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
})

// Canvas pixels are 8-bit sRGB with straight alpha. EXR readers expect scene-linear color
// with premultiplied alpha, so decode the transfer curve and multiply by alpha.
export function rgba8ToLinearPremultiplied(data: Uint8ClampedArray | Uint8Array): Float32Array {
  const out = new Float32Array(data.length)
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255
    out[i] = SRGB_TO_LINEAR[data[i]] * alpha
    out[i + 1] = SRGB_TO_LINEAR[data[i + 1]] * alpha
    out[i + 2] = SRGB_TO_LINEAR[data[i + 2]] * alpha
    out[i + 3] = alpha
  }
  return out
}

// Encodes one RGBA frame as a half-float, ZIP-compressed scanline EXR. Half floats keep
// every 8-bit level distinct at half the size of full floats.
export async function encodeExrFrame({
  data,
  width,
  height,
}: {
  data: Uint8ClampedArray | Uint8Array
  width: number
  height: number
}): Promise<Uint8Array<ArrayBuffer>> {
  const { Encoding, Image, SampleType, SpecificChannels, Vec2 } = await loadExrEncoder()
  // exrjs types the sample type parameter as 'f32' only; it accepts all SampleType values
  const halfFloat = SampleType.F16 as unknown as typeof SampleType.F32
  const channels = SpecificChannels.rgba(rgba8ToLinearPremultiplied(data), halfFloat)
  return Image.fromChannels(new Vec2(width, height), channels, Encoding.SMALL_LOSSLESS)
    .write()
    .toUint8Array()
}
