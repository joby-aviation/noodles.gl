import type { NoodlesProjectJSON } from '../utils/serialization'

// Migration to move render settings from Theatre.js staticOverrides to OutOp inputs
//
// This migration:
// 1. Extracts render settings (display, resolution, lod) from Theatre.js staticOverrides
// 2. Adds them as inputs to the OutOp operator (only if they exist)
// 3. Removes the render object from Theatre.js staticOverrides to clean up

export async function up(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  const { timeline, nodes, ...rest } = project

  // Extract render settings from Theatre.js staticOverrides
  const sheetsById = (timeline as any)?.sheetsById || {}
  const noodlesSheet = sheetsById.Noodles || {}
  const staticOverrides = noodlesSheet.staticOverrides || {}
  const byObject = staticOverrides.byObject || {}
  const renderOverrides = byObject.render || {}

  // Only migrate if render settings exist
  if (!Object.keys(renderOverrides).length) {
    return project
  }

  // Find OutOp node(s) and update with render settings
  const newNodes = nodes.map(node => {
    if (node.type === 'OutOp') {
      const inputs = { ...node.data.inputs }

      // Only add settings that exist in Theatre.js
      if (renderOverrides.display !== undefined) {
        inputs.display = renderOverrides.display
      }
      if (renderOverrides.resolution !== undefined) {
        inputs.resolution = renderOverrides.resolution
      }
      if (renderOverrides.lod !== undefined) {
        inputs.lod = renderOverrides.lod
      }

      return {
        ...node,
        data: {
          ...node.data,
          inputs,
        },
      }
    }
    return node
  })

  // Remove render from staticOverrides
  const { render: _, ...restOfObjects } = byObject
  const newStaticOverrides = {
    ...staticOverrides,
    byObject: restOfObjects,
  }

  // Update timeline without render staticOverrides
  const newTimeline = {
    ...timeline,
    sheetsById: {
      ...sheetsById,
      Noodles: {
        ...noodlesSheet,
        staticOverrides: newStaticOverrides,
      },
    },
  }

  return {
    ...rest,
    nodes: newNodes,
    timeline: newTimeline,
  }
}

export async function down(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  const { timeline, nodes, ...rest } = project

  // Extract render settings from OutOp
  const outOpNode = nodes.find(node => node.type === 'OutOp')
  const inputs = outOpNode?.data.inputs || {}

  // Only migrate back if OutOp has render settings
  const hasRenderSettings = inputs.display !== undefined ||
                            inputs.resolution !== undefined ||
                            inputs.lod !== undefined

  if (!hasRenderSettings) {
    return project
  }

  // Put render settings back into Theatre.js staticOverrides
  const sheetsById = (timeline as any)?.sheetsById || {}
  const noodlesSheet = sheetsById.Noodles || {}
  const staticOverrides = noodlesSheet.staticOverrides || {}
  const byObject = staticOverrides.byObject || {}

  const renderSettings: any = {}
  if (inputs.display !== undefined) renderSettings.display = inputs.display
  if (inputs.resolution !== undefined) renderSettings.resolution = inputs.resolution
  if (inputs.lod !== undefined) renderSettings.lod = inputs.lod

  const newTimeline = {
    ...timeline,
    sheetsById: {
      ...sheetsById,
      Noodles: {
        ...noodlesSheet,
        staticOverrides: {
          ...staticOverrides,
          byObject: {
            ...byObject,
            render: renderSettings,
          },
        },
      },
    },
  }

  // Remove render settings from OutOp nodes
  const newNodes = nodes.map(node => {
    if (node.type === 'OutOp') {
      const { display, resolution, lod, ...restOfInputs } = node.data.inputs
      return {
        ...node,
        data: {
          ...node.data,
          inputs: restOfInputs,
        },
      }
    }
    return node
  })

  return {
    ...rest,
    nodes: newNodes,
    timeline: newTimeline,
  }
}
