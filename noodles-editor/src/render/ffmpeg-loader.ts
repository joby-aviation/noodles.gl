// Lazy-load FFmpeg WASM from CDN for alpha video encoding.
// The WASM binary (~33MB) is loaded only when alpha export is requested.

// FFmpeg type - defined here to avoid requiring @ffmpeg/ffmpeg types at build time
// The actual implementation is loaded dynamically from the CDN
interface FFmpeg {
  load: (options: { coreURL: string; wasmURL: string }) => Promise<void>
  on: (event: string, callback: (data: { progress: number }) => void) => void
  exec: (args: string[]) => Promise<void>
  writeFile: (name: string, data: Uint8Array) => Promise<void>
  readFile: (name: string) => Promise<Uint8Array | ArrayBuffer>
  deleteFile: (name: string) => Promise<void>
  terminate: () => void
}

let ffmpegInstance: FFmpeg | null = null
let loadingPromise: Promise<FFmpeg> | null = null

export type FFmpegLoadProgress = {
  stage: 'downloading' | 'initializing'
  progress: number
}

// Get or load FFmpeg instance. Returns cached instance if already loaded.
export async function getFFmpeg(
  onProgress?: (progress: FFmpegLoadProgress) => void
): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance
  if (loadingPromise) return loadingPromise

  loadingPromise = (async () => {
    onProgress?.({ stage: 'downloading', progress: 0 })

    // Dynamic import to avoid bundling FFmpeg in main chunk
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { FFmpeg: FFmpegClass } = await import('@ffmpeg/ffmpeg') as { FFmpeg: new () => FFmpeg }
    ffmpegInstance = new FFmpegClass()

    // Track loading progress
    ffmpegInstance.on('progress', (data: { progress: number }) => {
      onProgress?.({ stage: 'initializing', progress: data.progress })
    })

    // Load from unpkg CDN - these files are cached by browser after first load
    await ffmpegInstance.load({
      coreURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js',
      wasmURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm',
    })

    onProgress?.({ stage: 'initializing', progress: 1 })

    return ffmpegInstance
  })()

  return loadingPromise
}

// Check if FFmpeg is already loaded (useful for UI to show loading state)
export function isFFmpegLoaded(): boolean {
  return ffmpegInstance !== null
}

// Unload FFmpeg to free memory (optional, for cleanup)
export function unloadFFmpeg(): void {
  if (ffmpegInstance) {
    ffmpegInstance.terminate()
    ffmpegInstance = null
    loadingPromise = null
  }
}
