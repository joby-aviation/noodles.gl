// Web Worker for EXR encoding. Runs compression off the main thread.
// Receives Float32Arrays via transferable objects (zero-copy).

import * as exrjs from 'exrjs'

const { EXRWriter, Compression } = exrjs

export interface ExrEncodeRequest {
  id: number
  width: number
  height: number
  rgbaPixels: Float32Array
  depth: Float32Array | null
  compression: 'none' | 'zip' | 'piz'
}

export interface ExrEncodeResponse {
  id: number
  exrData: Uint8Array
  // Return buffers so they can be released back to the pool
  rgbaPixels: Float32Array
  depth: Float32Array | null
}

self.onmessage = (event: MessageEvent<ExrEncodeRequest>) => {
  const { id, width, height, rgbaPixels, depth, compression } = event.data

  const compressionType = {
    none: Compression.Uncompressed,
    zip: Compression.ZIP16,
    piz: Compression.PIZ,
  }[compression]

  const writer = new EXRWriter(width, height)

  writer
    .addLayer('Beauty')
    .rgba(rgbaPixels)
    .compression(compressionType)
    .sampleType('f32')
    .scanlines()
    .end()

  if (depth) {
    writer
      .addLayer('Depth')
      .channel('Z', 'f32', depth)
      .compression(compressionType)
      .sampleType('f32')
      .end()
  }

  const buffer = writer.encode()
  const exrData = new Uint8Array(buffer)

  const response: ExrEncodeResponse = { id, exrData, rgbaPixels, depth }

  // Transfer ownership back to main thread (zero-copy)
  const transfers: Transferable[] = [exrData.buffer, rgbaPixels.buffer]
  if (depth) transfers.push(depth.buffer)

  // Use postMessage with transfer list (TypeScript doesn't have good worker types)
  ;(self as DedicatedWorkerGlobalScope).postMessage(response, transfers)
}
