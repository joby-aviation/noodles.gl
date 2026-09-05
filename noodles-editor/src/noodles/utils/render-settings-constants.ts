// Render settings types and constants
// This file has NO dependencies so it can be used by migrations

export type RenderSettings = {
  display: 'fixed' | 'responsive'
  resolution: { width: number; height: number }
  lod: number
  scaleMode: 'fit' | 'manual'
  waitForData: boolean
  codec: 'avc' | 'hevc' | 'vp9' | 'av1'
  bitrateMbps: number
  bitrateMode: 'constant' | 'variable'
  scaleControl: number
  framerate: number
  captureDelay: number
  fileName: string
  rendersDirectory: string
}

export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  display: 'fixed',
  resolution: { width: 1920, height: 1080 },
  lod: 2,
  scaleMode: 'fit',
  waitForData: true,
  codec: 'avc',
  bitrateMbps: 10,
  bitrateMode: 'constant',
  scaleControl: 0.3,
  framerate: 30,
  captureDelay: 50,
  fileName: '',
  rendersDirectory: 'renders',
}
