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
  error?: undefined
}

export interface ExrEncodeError {
  id: number
  error: string
  rgbaPixels: Float32Array
  depth: Float32Array | null
}

console.log('[exr-worker] Worker initialized')

self.onmessage = (event: MessageEvent<ExrEncodeRequest>) => {
  const { id, width, height, rgbaPixels, depth, compression } = event.data
  console.log(`[exr-worker] Received encode request id=${id} ${width}x${height}`)

  try {
    const compressionType = {
      none: Compression.Uncompressed,
      zip: Compression.ZIP16,
      piz: Compression.PIZ,
    }[compression]

    const startTime = performance.now()
    const writer = new EXRWriter(width, height)

    console.log(`[exr-worker] id=${id} adding Beauty layer...`)
    writer
      .addLayer('Beauty')
      .rgba(rgbaPixels)
      .compression(compressionType)
      .sampleType('f32')
      .scanlines()
      .end()

    if (depth) {
      console.log(`[exr-worker] id=${id} adding Depth layer...`)
      writer
        .addLayer('Depth')
        .channel('Z', 'f32', depth)
        .compression(compressionType)
        .sampleType('f32')
        .end()
    }

    console.log(`[exr-worker] id=${id} encoding (compression=${compression})...`)
    const buffer = writer.encode()
    const exrData = new Uint8Array(buffer)
    const elapsed = ((performance.now() - startTime) / 1000).toFixed(1)
    console.log(`[exr-worker] Encoded id=${id}, size=${exrData.byteLength} bytes, took ${elapsed}s`)

    const response: ExrEncodeResponse = { id, exrData, rgbaPixels, depth }

    // Transfer ownership back to main thread (zero-copy)
    const transfers: Transferable[] = [exrData.buffer, rgbaPixels.buffer]
    if (depth) transfers.push(depth.buffer)

    ;(self as DedicatedWorkerGlobalScope).postMessage(response, transfers)
    console.log(`[exr-worker] Posted response id=${id}`)
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e)
    console.error('[exr-worker] Encoding failed:', errorMsg)

    const errorResponse: ExrEncodeError = {
      id,
      error: errorMsg,
      rgbaPixels,
      depth,
    }

    // Return buffers even on error so they can be released
    const transfers: Transferable[] = [rgbaPixels.buffer]
    if (depth) transfers.push(depth.buffer)

    ;(self as DedicatedWorkerGlobalScope).postMessage(errorResponse, transfers)
  }
}
