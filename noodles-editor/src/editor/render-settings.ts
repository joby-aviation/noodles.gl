// The deck node's export parameters as the renderer's settings: the top bar and the
// timeline editor read the same ones.

import type { EditorDoc } from '@noodles.gl/planner'
import { DEFAULT_RENDER_SETTINGS, type RenderSettings } from '../noodles/utils/serialization'

/** The planner operator that is a document's output: its deck, basemap and export settings. */
export const DOC_DECK = 'deck'

export function renderSettingsOf(doc: EditorDoc): RenderSettings {
  const p = doc.nodes.find(n => n.op === DOC_DECK)?.params ?? {}
  const d = DEFAULT_RENDER_SETTINGS
  const pick = <T>(key: string, fallback: T): T => (p[key] ?? fallback) as T
  return {
    display: pick('display', d.display),
    resolution: {
      width: pick('width', d.resolution.width),
      height: pick('height', d.resolution.height),
    },
    lod: pick('lod', d.lod),
    scaleMode: pick('scaleMode', d.scaleMode),
    waitForData: pick('waitForData', d.waitForData),
    codec: pick('codec', d.codec),
    bitrateMbps: pick('bitrateMbps', d.bitrateMbps),
    bitrateMode: pick('bitrateMode', d.bitrateMode),
    exportAlpha: pick('exportAlpha', d.exportAlpha),
    scaleControl: pick('scaleControl', d.scaleControl),
    framerate: pick('framerate', d.framerate),
    captureDelay: pick('captureDelay', d.captureDelay),
    captureMode: pick('captureMode', d.captureMode),
    rendersDirectory: pick('rendersDirectory', d.rendersDirectory),
    sequenceFormat: pick('sequenceFormat', d.sequenceFormat),
  }
}
