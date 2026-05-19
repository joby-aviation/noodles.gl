/**
 * EXR encoding benchmark: exrjs vs exrs (WASM)
 *
 * Run in browser console:
 *   await runExrBenchmark()
 */

import * as exrjs from 'exrjs'
import { init as initExrs, encodeRgbaExr, encodeExr, RGBA } from 'exrs'

const { EXRWriter, Compression } = exrjs

interface BenchmarkResult {
  size: string
  compression: string
  library: string
  timeMs: number
  outputBytes: number
}

const SIZES = [
  { name: '1080p', width: 1920, height: 1080 },
  { name: '4K', width: 3840, height: 2160 },
]

const COMPRESSIONS = ['none', 'zip', 'piz'] as const
type CompressionType = (typeof COMPRESSIONS)[number]

const ITERATIONS = 3

function generateTestPixels(width: number, height: number): Float32Array {
  const pixels = new Float32Array(width * height * 4)
  // Generate gradient pattern (more realistic than random noise for compression)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      pixels[i] = x / width // R: horizontal gradient
      pixels[i + 1] = y / height // G: vertical gradient
      pixels[i + 2] = (x + y) / (width + height) // B: diagonal gradient
      pixels[i + 3] = 1.0 // A: fully opaque
    }
  }
  return pixels
}

function encodeWithExrjs(
  pixels: Float32Array,
  width: number,
  height: number,
  compression: CompressionType
): Uint8Array {
  const compressionType = {
    none: Compression.Uncompressed,
    zip: Compression.ZIP16,
    piz: Compression.PIZ,
  }[compression]

  const writer = new EXRWriter(width, height)
  writer
    .addLayer('Beauty')
    .rgba(pixels)
    .compression(compressionType)
    .sampleType('f32')
    .scanlines()
    .end()

  return new Uint8Array(writer.encode())
}

// Maps our compression names to exrs compression strings
const EXRS_COMPRESSION = {
  none: 'none',
  zip: 'zip16',
  piz: 'piz',
} as const

function encodeWithExrs(
  pixels: Float32Array,
  width: number,
  height: number,
  compression: CompressionType
): Uint8Array {
  return encodeRgbaExr({
    width,
    height,
    interleavedRgbaPixels: pixels,
    compression: EXRS_COMPRESSION[compression],
    precision: 'f32',
  })
}

function encodeWithExrsMultiLayer(
  pixels: Float32Array,
  width: number,
  height: number,
  compression: CompressionType
): Uint8Array {
  return encodeExr({
    width,
    height,
    layers: [
      {
        name: 'Beauty',
        channelNames: RGBA,
        interleavedPixels: pixels,
        compression: EXRS_COMPRESSION[compression],
        precision: 'f32',
      },
    ],
  })
}

async function runBenchmark(): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = []

  console.log('EXR Encoding Benchmark')
  console.log('======================')
  console.log(`Iterations per test: ${ITERATIONS}`)
  console.log('')

  // Initialize exrs WASM
  console.log('Initializing exrs WASM...')
  await initExrs()
  console.log('exrs WASM ready')
  console.log('')

  for (const size of SIZES) {
    console.log(`Generating ${size.name} test pixels (${size.width}x${size.height})...`)
    const pixels = generateTestPixels(size.width, size.height)
    console.log(`  Generated ${(pixels.byteLength / 1024 / 1024).toFixed(1)} MB`)

    for (const compression of COMPRESSIONS) {
      // --- exrjs ---
      encodeWithExrjs(pixels, size.width, size.height, compression) // warm up
      const exrjsTimes: number[] = []
      let exrjsBytes = 0
      for (let i = 0; i < ITERATIONS; i++) {
        const start = performance.now()
        const output = encodeWithExrjs(pixels, size.width, size.height, compression)
        exrjsTimes.push(performance.now() - start)
        exrjsBytes = output.byteLength
      }
      const exrjsAvg = exrjsTimes.reduce((a, b) => a + b, 0) / exrjsTimes.length
      results.push({
        size: size.name,
        compression,
        library: 'exrjs 0.3.1',
        timeMs: Math.round(exrjsAvg),
        outputBytes: exrjsBytes,
      })
      console.log(
        `  ${size.name} ${compression} exrjs: ${exrjsAvg.toFixed(0)}ms, ${(exrjsBytes / 1024 / 1024).toFixed(1)} MB`
      )

      // --- exrs (WASM) encodeRgbaExr ---
      encodeWithExrs(pixels, size.width, size.height, compression) // warm up
      const exrsTimes: number[] = []
      let exrsBytes = 0
      for (let i = 0; i < ITERATIONS; i++) {
        const start = performance.now()
        const output = encodeWithExrs(pixels, size.width, size.height, compression)
        exrsTimes.push(performance.now() - start)
        exrsBytes = output.byteLength
      }
      const exrsAvg = exrsTimes.reduce((a, b) => a + b, 0) / exrsTimes.length
      results.push({
        size: size.name,
        compression,
        library: 'exrs 1.0.3 (rgba)',
        timeMs: Math.round(exrsAvg),
        outputBytes: exrsBytes,
      })
      console.log(
        `  ${size.name} ${compression} exrs(rgba): ${exrsAvg.toFixed(0)}ms, ${(exrsBytes / 1024 / 1024).toFixed(1)} MB`
      )

      // --- exrs (WASM) encodeExr (multi-layer API) ---
      encodeWithExrsMultiLayer(pixels, size.width, size.height, compression) // warm up
      const exrsMLTimes: number[] = []
      let exrsMLBytes = 0
      for (let i = 0; i < ITERATIONS; i++) {
        const start = performance.now()
        const output = encodeWithExrsMultiLayer(pixels, size.width, size.height, compression)
        exrsMLTimes.push(performance.now() - start)
        exrsMLBytes = output.byteLength
      }
      const exrsMLAvg = exrsMLTimes.reduce((a, b) => a + b, 0) / exrsMLTimes.length
      results.push({
        size: size.name,
        compression,
        library: 'exrs 1.0.3 (multi)',
        timeMs: Math.round(exrsMLAvg),
        outputBytes: exrsMLBytes,
      })
      console.log(
        `  ${size.name} ${compression} exrs(multi): ${exrsMLAvg.toFixed(0)}ms, ${(exrsMLBytes / 1024 / 1024).toFixed(1)} MB`
      )
    }
  }

  console.log('')
  console.log('Results:')
  console.table(
    results.map((r) => ({
      Size: r.size,
      Compression: r.compression,
      Library: r.library,
      'Time (ms)': r.timeMs,
      'Output (MB)': (r.outputBytes / 1024 / 1024).toFixed(1),
    }))
  )

  return results
}

// Export to window for easy console access
;(window as unknown as { runExrBenchmark: typeof runBenchmark }).runExrBenchmark = runBenchmark

export { runBenchmark }
