// Migration to remove MapStyleOp nodes and inline their value onto connected
// MaplibreBasemapOp inputs. The MapStyleOp was a pass-through node that only
// existed to expose a preset map style URL as a string output.

import type { NoodlesProjectJSON } from '../utils/serialization'

const CARTO_DARK = 'https://basemaps.cartocdn.com/gl/dark-matter-nolabels-gl-style/style.json'

export async function up(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  const mapStyleNodes = project.nodes.filter(n => n.type === 'MapStyleOp')
  if (mapStyleNodes.length === 0) return project

  const mapStyleIds = new Set(mapStyleNodes.map(n => n.id))

  // Build a map of mapStyleOpId -> the style URL value it held
  const styleValues = new Map<string, string>()
  for (const node of mapStyleNodes) {
    const val = (node.data?.inputs as Record<string, unknown> | undefined)?.mapStyle
    styleValues.set(node.id, typeof val === 'string' ? val : CARTO_DARK)
  }

  // Find edges from MapStyleOp.out.mapStyle -> MaplibreBasemapOp.par.mapStyle
  // and record what value each target node should receive
  const targetValues = new Map<string, string>()
  for (const edge of project.edges) {
    if (mapStyleIds.has(edge.source) && edge.sourceHandle === 'out.mapStyle') {
      const styleUrl = styleValues.get(edge.source)
      if (styleUrl !== undefined) {
        targetValues.set(edge.target, styleUrl)
      }
    }
  }

  // Apply values to target nodes and remove MapStyleOp nodes + their edges
  const nodes = project.nodes
    .filter(n => !mapStyleIds.has(n.id))
    .map(node => {
      const val = targetValues.get(node.id)
      if (val === undefined) return node
      return {
        ...node,
        data: {
          ...node.data,
          inputs: {
            ...(node.data?.inputs as Record<string, unknown> | undefined),
            mapStyle: val,
          },
        },
      }
    })

  const edges = project.edges.filter(
    e => !mapStyleIds.has(e.source) && !mapStyleIds.has(e.target)
  )

  return { ...project, nodes, edges }
}

export async function down(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  // For each MaplibreBasemapOp with a mapStyle input value and no incoming edge
  // for par.mapStyle, recreate a MapStyleOp node and connecting edge
  const connectedTargets = new Set(
    project.edges
      .filter(e => e.targetHandle === 'par.mapStyle')
      .map(e => e.target)
  )

  const newNodes = [...project.nodes]
  const newEdges = [...project.edges]

  for (const node of project.nodes) {
    if (node.type !== 'MaplibreBasemapOp') continue
    if (connectedTargets.has(node.id)) continue

    const val = (node.data?.inputs as Record<string, unknown> | undefined)?.mapStyle
    if (typeof val !== 'string') continue

    const mapStyleId = `${node.id}-map-style`
    newNodes.push({
      id: mapStyleId,
      type: 'MapStyleOp',
      position: { x: node.position.x - 320, y: node.position.y },
      data: { inputs: { mapStyle: val } },
    })

    newEdges.push({
      id: `${mapStyleId}.out.mapStyle->${node.id}.par.mapStyle`,
      source: mapStyleId,
      target: node.id,
      sourceHandle: 'out.mapStyle',
      targetHandle: 'par.mapStyle',
    })
  }

  // Remove mapStyle from MaplibreBasemapOp inputs where we just created a MapStyleOp
  const createdIds = new Set(newNodes.filter(n => n.type === 'MapStyleOp').map(n => n.id))
  const targetIds = new Set(
    newEdges
      .filter(e => createdIds.has(e.source))
      .map(e => e.target)
  )

  const nodes = newNodes.map(node => {
    if (!targetIds.has(node.id)) return node
    const { mapStyle: _, ...restInputs } = (node.data?.inputs as Record<string, unknown>) ?? {}
    return {
      ...node,
      data: { ...node.data, inputs: restInputs },
    }
  })

  return { ...project, nodes, edges: newEdges }
}
