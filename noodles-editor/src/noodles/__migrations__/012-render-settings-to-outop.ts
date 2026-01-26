import type { NoodlesProjectJSON, RenderSettings } from '../utils/serialization'
import { DEFAULT_RENDER_SETTINGS } from '../utils/serialization'

// Migration to move render settings from Theatre.js staticOverrides and project-level settings
// to OutOp input fields.
//
// This migration handles three possible sources:
// 1. Theatre.js staticOverrides.byObject.render (legacy format)
// 2. Project-level renderSettings (intermediate format from PR #266)
// 3. No render settings (use defaults)
//
// After migration, render settings are stored as OutOp node inputs.

// Extract render settings from legacy Theatre.js location
function getLegacyTheatreSettings(
  timeline: Record<string, unknown> | undefined
): Partial<RenderSettings> | undefined {
  const sheetsById = (timeline as { sheetsById?: Record<string, unknown> })?.sheetsById
  const noodlesSheet = (sheetsById?.Noodles ?? {}) as {
    staticOverrides?: { byObject?: { render?: Partial<RenderSettings> } }
  }
  return noodlesSheet.staticOverrides?.byObject?.render
}

// Remove render settings from Theatre.js staticOverrides
function clearTheatreRenderSettings(timeline: Record<string, unknown>): Record<string, unknown> {
  const sheetsById = (timeline as { sheetsById?: Record<string, unknown> })?.sheetsById || {}
  const noodlesSheet = (sheetsById.Noodles ?? {}) as {
    staticOverrides?: { byObject?: Record<string, unknown> }
  }
  const staticOverrides = noodlesSheet.staticOverrides || {}
  const byObject = staticOverrides.byObject || {}

  // Remove render from byObject
  const { render: _, ...restOfObjects } = byObject

  return {
    ...timeline,
    sheetsById: {
      ...sheetsById,
      Noodles: {
        ...noodlesSheet,
        staticOverrides: {
          ...staticOverrides,
          byObject: restOfObjects,
        },
      },
    },
  }
}

export async function up(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  const { timeline, renderSettings: projectRenderSettings, ...rest } = project

  // Determine which render settings to use (priority: project-level > Theatre.js > defaults)
  let sourceSettings: Partial<RenderSettings> = {}

  if (projectRenderSettings) {
    // Project-level settings from PR #266
    sourceSettings = projectRenderSettings
  } else {
    // Try legacy Theatre.js location
    const legacySettings = getLegacyTheatreSettings(timeline)
    if (legacySettings) {
      sourceSettings = legacySettings
    }
  }

  // Merge with defaults to get complete settings
  const fullSettings: RenderSettings = {
    ...DEFAULT_RENDER_SETTINGS,
    ...sourceSettings,
  }

  // Find the OutOp node and add render settings to its inputs
  const nodes = project.nodes.map(node => {
    if (node.type === 'OutOp') {
      return {
        ...node,
        data: {
          ...node.data,
          inputs: {
            ...(node.data?.inputs || {}),
            display: fullSettings.display,
            width: fullSettings.resolution.width,
            height: fullSettings.resolution.height,
            lod: fullSettings.lod,
            waitForData: fullSettings.waitForData,
            codec: fullSettings.codec,
            bitrateMbps: fullSettings.bitrateMbps,
            bitrateMode: fullSettings.bitrateMode,
            scaleControl: fullSettings.scaleControl,
            framerate: fullSettings.framerate,
            captureDelay: fullSettings.captureDelay,
          },
        },
      }
    }
    return node
  })

  // Clear Theatre.js render settings if present
  const newTimeline = timeline ? clearTheatreRenderSettings(timeline) : timeline

  // Return project without project-level renderSettings
  return {
    ...rest,
    nodes,
    timeline: newTimeline,
    // Note: renderSettings is intentionally not included (removed from project root)
  }
}

export async function down(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  const { timeline, ...rest } = project

  // Find OutOp and extract render settings from its inputs
  const outNode = project.nodes.find(node => node.type === 'OutOp')
  const inputs = outNode?.data?.inputs || {}

  // Build render settings from OutOp inputs
  const renderSettings: Partial<RenderSettings> = {}

  if (inputs.display !== undefined) renderSettings.display = inputs.display
  if (inputs.width !== undefined || inputs.height !== undefined) {
    renderSettings.resolution = {
      width: inputs.width ?? DEFAULT_RENDER_SETTINGS.resolution.width,
      height: inputs.height ?? DEFAULT_RENDER_SETTINGS.resolution.height,
    }
  }
  if (inputs.lod !== undefined) renderSettings.lod = inputs.lod
  if (inputs.waitForData !== undefined) renderSettings.waitForData = inputs.waitForData
  if (inputs.codec !== undefined) renderSettings.codec = inputs.codec
  if (inputs.bitrateMbps !== undefined) renderSettings.bitrateMbps = inputs.bitrateMbps
  if (inputs.bitrateMode !== undefined) renderSettings.bitrateMode = inputs.bitrateMode
  if (inputs.scaleControl !== undefined) renderSettings.scaleControl = inputs.scaleControl
  if (inputs.framerate !== undefined) renderSettings.framerate = inputs.framerate
  if (inputs.captureDelay !== undefined) renderSettings.captureDelay = inputs.captureDelay

  // Remove render settings from OutOp inputs
  const nodes = project.nodes.map(node => {
    if (node.type === 'OutOp') {
      const { inputs: nodeInputs = {}, ...nodeData } = node.data || {}
      const {
        display: _d,
        width: _w,
        height: _h,
        lod: _l,
        waitForData: _wfd,
        codec: _c,
        bitrateMbps: _b,
        bitrateMode: _bm,
        scaleControl: _sc,
        framerate: _f,
        captureDelay: _cd,
        ...restInputs
      } = nodeInputs as Record<string, unknown>

      return {
        ...node,
        data: {
          ...nodeData,
          inputs: restInputs,
        },
      }
    }
    return node
  })

  // Only include non-default settings in project-level renderSettings
  const hasNonDefaults = Object.keys(renderSettings).length > 0

  return {
    ...rest,
    nodes,
    timeline,
    ...(hasNonDefaults ? { renderSettings } : {}),
  }
}
