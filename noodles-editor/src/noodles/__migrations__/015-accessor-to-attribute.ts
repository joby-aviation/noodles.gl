import type { NoodlesProjectJSON } from '../utils/serialization'
import { edgeId } from '../utils/id-utils'

// Migration to convert AccessorOp nodes to CreateAttributeOp
//
// This migration transforms the old accessor-based pattern:
//   Data -> AccessorOp(expression) -> Layer.getPosition
//
// Into the new attribute-based pattern:
//   Data -> CreateAttributeOp(name, expression) -> Layer.data
//
// The migration:
// 1. Identifies AccessorOp nodes connected to layer operator inputs
// 2. Converts them to CreateAttributeOp nodes with appropriate settings
// 3. Chains multiple CreateAttributeOps for the same data stream
// 4. Updates connections to pass attribute-enhanced data to layers
// 5. Re-layouts graph to improve readability

const LAYER_OPS = [
  'ScatterplotLayerOp',
  'PathLayerOp',
  'ArcLayerOp',
  'LineLayerOp',
  'IconLayerOp',
  'TextLayerOp',
  'PolygonLayerOp',
  'SolidPolygonLayerOp',
  'GeoJsonLayerOp',
  'ColumnLayerOp',
  'GridLayerOp',
  'GridCellLayerOp',
  'HexagonLayerOp',
  'ContourLayerOp',
  'ScreenGridLayerOp',
  'HeatmapLayerOp',
  'H3HexagonLayerOp',
  'H3ClusterLayerOp',
  'GreatCircleLayerOp',
  'TripsLayerOp',
]

const ACCESSOR_FIELD_TO_ATTRIBUTE: Record<string, string> = {
  getPosition: 'position',
  getFillColor: 'fillColor',
  getLineColor: 'lineColor',
  getColor: 'color',
  getRadius: 'radius',
  getLineWidth: 'lineWidth',
  getWidth: 'width',
  getHeight: 'height',
  getElevation: 'elevation',
  getSize: 'size',
  getAngle: 'angle',
  getPath: 'path',
  getSourcePosition: 'sourcePosition',
  getTargetPosition: 'targetPosition',
  getSourceColor: 'sourceColor',
  getTargetColor: 'targetColor',
  getTimestamps: 'timestamps',
}

export async function up(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  const { nodes, edges } = project

  // Find all AccessorOp nodes connected to layer inputs
  const accessorNodes = new Map(
    nodes.filter(n => n.type === 'AccessorOp').map(n => [n.id, n])
  )

  if (accessorNodes.size === 0) {
    return project
  }

  const layerNodes = new Map(
    nodes.filter(n => LAYER_OPS.includes(n.type as string)).map(n => [n.id, n])
  )

  // Map: layer node ID -> list of accessor edges
  const layerAccessors = new Map<string, Array<{ edge: typeof edges[0]; fieldName: string }>>()

  for (const edge of edges) {
    const targetNode = layerNodes.get(edge.target)
    const sourceNode = accessorNodes.get(edge.source)

    if (targetNode && sourceNode && edge.targetHandle && edge.targetHandle.startsWith('par.get')) {
      const fieldName = edge.targetHandle.replace('par.', '')
      const existing = layerAccessors.get(edge.target) || []
      existing.push({ edge, fieldName })
      layerAccessors.set(edge.target, existing)
    }
  }

  if (layerAccessors.size === 0) {
    return project
  }

  const newNodes = [...nodes]
  const newEdges = [...edges]
  const nodesToRemove = new Set<string>()
  const edgesToRemove = new Set<string>()

  // Process each layer
  for (const [layerId, accessorEdges] of layerAccessors) {
    const layerNode = layerNodes.get(layerId)!

    // Find the data source for this layer
    const dataEdge = edges.find(e => e.target === layerId && e.targetHandle === 'par.data')
    if (!dataEdge) continue

    let currentDataSource = dataEdge.source
    let currentDataHandle = dataEdge.sourceHandle

    // Create CreateAttributeOp for each accessor
    for (const { edge, fieldName } of accessorEdges) {
      const accessorNode = accessorNodes.get(edge.source)!
      const expression = accessorNode.data.inputs?.expression || 'd'
      const attributeName = ACCESSOR_FIELD_TO_ATTRIBUTE[fieldName] || fieldName.replace('get', '').toLowerCase()

      // Create CreateAttributeOp node
      const createAttrNodeId = accessorNode.id.includes('/accessor-')
        ? accessorNode.id.replace('/accessor-', '/create-attr-')
        : `${accessorNode.id}-create-attr-${attributeName}`
      const createAttrNode = {
        id: createAttrNodeId,
        type: 'CreateAttributeOp',
        position: {
          x: accessorNode.position.x,
          y: accessorNode.position.y,
        },
        data: {
          inputs: {
            data: undefined, // Will be connected
            name: attributeName,
            expression,
            type: fieldName.includes('Color') ? 'uint8' : 'float',
            size: fieldName === 'getPosition' || fieldName === 'getSourcePosition' || fieldName === 'getTargetPosition' ? 3 :
                  fieldName.includes('Color') ? 4 : 1,
          },
        },
      }

      newNodes.push(createAttrNode)

      // Connect data source to CreateAttributeOp
      const dataInputEdge = {
        id: edgeId({
          source: currentDataSource,
          target: createAttrNodeId,
          sourceHandle: currentDataHandle,
          targetHandle: 'par.data',
        }),
        source: currentDataSource,
        target: createAttrNodeId,
        sourceHandle: currentDataHandle,
        targetHandle: 'par.data',
      }
      newEdges.push(dataInputEdge)

      // Chain for next CreateAttributeOp
      currentDataSource = createAttrNodeId
      currentDataHandle = 'out.data'

      // Mark accessor node for removal
      nodesToRemove.add(edge.source)
      edgesToRemove.add(edge.id)
    }

    // Update layer's data connection to point to last CreateAttributeOp
    const layerDataEdgeIndex = newEdges.findIndex(
      e => e.target === layerId && e.targetHandle === 'par.data'
    )
    if (layerDataEdgeIndex >= 0) {
      const oldEdge = newEdges[layerDataEdgeIndex]
      newEdges[layerDataEdgeIndex] = {
        ...oldEdge,
        source: currentDataSource,
        sourceHandle: currentDataHandle,
        id: edgeId({
          source: currentDataSource,
          target: layerId,
          sourceHandle: currentDataHandle,
          targetHandle: 'par.data',
        }),
      }
    }
  }

  // Remove old accessor nodes and edges
  const filteredNodes = newNodes.filter(n => !nodesToRemove.has(n.id))
  const filteredEdges = newEdges.filter(e => !edgesToRemove.has(e.id))

  // Re-layout: position CreateAttributeOp nodes vertically
  const createAttrNodeIds = new Set(
    filteredNodes.filter(n => n.type === 'CreateAttributeOp').map(n => n.id)
  )

  let createAttrIndex = 0
  const finalNodes = filteredNodes.map(node => {
    if (node.type === 'CreateAttributeOp') {
      const yOffset = 120
      const newY = node.position.y + createAttrIndex * yOffset
      createAttrIndex++
      return {
        ...node,
        position: {
          ...node.position,
          y: newY,
        },
      }
    }
    return node
  })

  return {
    ...project,
    nodes: finalNodes,
    edges: filteredEdges,
  }
}

export async function down(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  // Downgrade is not supported for this migration as it would require
  // converting attribute names back to accessor expressions, which may lose information
  return project
}
