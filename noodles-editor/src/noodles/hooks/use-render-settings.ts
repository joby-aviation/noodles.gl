import { useEffect, useState } from 'react'
import type { OutOp } from '../operators'
import type { RenderSettings } from '../utils/serialization'
import { DEFAULT_RENDER_SETTINGS } from '../utils/serialization'
import { useActiveOutOp } from './use-active-outop'

// Hook to read render settings from the active OutOp node.
// Render settings are stored as OutOp input fields (not keyframable).
// This hook subscribes to changes in those fields and returns the current values.
// Uses the "active OutOp" system - similar to Blender's active camera concept.
export function useRenderSettings(): RenderSettings {
  const outOp = useActiveOutOp()

  const [settings, setSettings] = useState<RenderSettings>(() => {
    if (!outOp) return { ...DEFAULT_RENDER_SETTINGS }
    return getRenderSettingsFromOutOp(outOp)
  })

  useEffect(() => {
    if (!outOp) {
      setSettings({ ...DEFAULT_RENDER_SETTINGS })
      return
    }

    // Subscribe to all render setting fields
    const subscriptions = [
      outOp.inputs.display.subscribe(() => updateSettings()),
      outOp.inputs.width.subscribe(() => updateSettings()),
      outOp.inputs.height.subscribe(() => updateSettings()),
      outOp.inputs.lod.subscribe(() => updateSettings()),
      outOp.inputs.waitForData.subscribe(() => updateSettings()),
      outOp.inputs.codec.subscribe(() => updateSettings()),
      outOp.inputs.bitrateMbps.subscribe(() => updateSettings()),
      outOp.inputs.bitrateMode.subscribe(() => updateSettings()),
      outOp.inputs.scaleControl.subscribe(() => updateSettings()),
      outOp.inputs.framerate.subscribe(() => updateSettings()),
      outOp.inputs.captureDelay.subscribe(() => updateSettings()),
    ]

    function updateSettings() {
      setSettings(getRenderSettingsFromOutOp(outOp!))
    }

    // Initial update
    updateSettings()

    return () => {
      for (const sub of subscriptions) {
        sub.unsubscribe()
      }
    }
  }, [outOp])

  return settings
}

// Get render settings from an OutOp instance.
// Combines width/height fields into a resolution object for compatibility.
export function getRenderSettingsFromOutOp(outOp: OutOp): RenderSettings {
  return {
    display: outOp.inputs.display.value as RenderSettings['display'],
    resolution: {
      width: outOp.inputs.width.value,
      height: outOp.inputs.height.value,
    },
    lod: outOp.inputs.lod.value,
    waitForData: outOp.inputs.waitForData.value,
    codec: outOp.inputs.codec.value as RenderSettings['codec'],
    bitrateMbps: outOp.inputs.bitrateMbps.value,
    bitrateMode: outOp.inputs.bitrateMode.value as RenderSettings['bitrateMode'],
    scaleControl: outOp.inputs.scaleControl.value,
    framerate: outOp.inputs.framerate.value,
    captureDelay: outOp.inputs.captureDelay.value,
  }
}

// Helper function to programmatically update render settings on the OutOp node.
// Primarily useful for external scripts or testing.
export function setRenderSettingsOnOutOp(outOp: OutOp, settings: Partial<RenderSettings>): void {
  if (settings.display !== undefined) {
    outOp.inputs.display.setValue(settings.display)
  }
  if (settings.resolution !== undefined) {
    outOp.inputs.width.setValue(settings.resolution.width)
    outOp.inputs.height.setValue(settings.resolution.height)
  }
  if (settings.lod !== undefined) {
    outOp.inputs.lod.setValue(settings.lod)
  }
  if (settings.waitForData !== undefined) {
    outOp.inputs.waitForData.setValue(settings.waitForData)
  }
  if (settings.codec !== undefined) {
    outOp.inputs.codec.setValue(settings.codec)
  }
  if (settings.bitrateMbps !== undefined) {
    outOp.inputs.bitrateMbps.setValue(settings.bitrateMbps)
  }
  if (settings.bitrateMode !== undefined) {
    outOp.inputs.bitrateMode.setValue(settings.bitrateMode)
  }
  if (settings.scaleControl !== undefined) {
    outOp.inputs.scaleControl.setValue(settings.scaleControl)
  }
  if (settings.framerate !== undefined) {
    outOp.inputs.framerate.setValue(settings.framerate)
  }
  if (settings.captureDelay !== undefined) {
    outOp.inputs.captureDelay.setValue(settings.captureDelay)
  }
}
