import type { NoodlesProjectJSON } from '../utils/serialization'
import { edgeId } from '../utils/id-utils'

// Migration to convert AccessorOp nodes to CreateAttributeOp (expression-only mode)
//
// This migration transforms the old accessor-based pattern:
//   Data -> AccessorOp(expression) -> Layer.getPosition
//
// Into the new attribute-based pattern:
//   Data -> CreateAttributeOp(name, expression) -> Layer.data
//
// Key improvements:
// 1. Deduplicates CreateAttributeOps - creates ONE per unique AccessorOp/data source combo
// 2. Uses expression-only mode (no source/column inputs)
// 3. Shares CreateAttributeOp outputs across multiple layers
// 4. Updates connections to pass attribute-enhanced data to layers

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
  'BitmapLayerOp',
  'GeohashLayerOp',
  'S2LayerOp',
  'QuadkeyLayerOp',
  'A5LayerOp',
  'PointCloudLayerOp',
  'ScenegraphLayerOp',
  'SimpleMeshLayerOp',
  'TileLayerOp',
  'Tile3DLayerOp',
  'TerrainLayerOp',
  'MVTLayerOp',
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

interface AccessorUsage {
  accessorId: string
  accessorNode: NoodlesProjectJSON['nodes'][0]
  dataSourceId: string
  dataSourceHandle: string
  layers: Array<{
    layerId: string
    fieldName: string
    edgeId: string
  }>
}

export async function up(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  const { nodes, edges } = project

  // Find all AccessorOp nodes
  const accessorNodes = new Map(
    nodes.filter(n => n.type === 'AccessorOp').map(n => [n.id, n])
  )

  if (accessorNodes.size === 0) {
    return project
  }

  const layerNodes = new Map(
    nodes.filter(n => LAYER_OPS.includes(n.type as string)).map(n => [n.id, n])
  )

  // Group accessor usage by unique (accessorId, dataSource) combinations
  // This ensures we deduplicate: same accessor + same data = one CreateAttributeOp
  const accessorUsages = new Map<string, AccessorUsage>()

  for (const edge of edges) {
    // Find AccessorOp -> Layer accessor field connections
    const targetNode = layerNodes.get(edge.target)
    const sourceNode = accessorNodes.get(edge.source)

    if (targetNode && sourceNode && edge.targetHandle?.startsWith('par.get')) {
      const layerId = edge.target
      const accessorId = edge.source
      const fieldName = edge.targetHandle.replace('par.', '')

      // Find the data source for this layer
      const dataEdge = edges.find(e => e.target === layerId && e.targetHandle === 'par.data')
      if (!dataEdge) continue

      // Key: unique combo of accessor + data source
      const key = `${accessorId}:${dataEdge.source}:${dataEdge.sourceHandle}`

      const existing = accessorUsages.get(key)
      if (existing) {
        // Add this layer to existing accessor usage
        existing.layers.push({ layerId, fieldName, edgeId: edge.id })
      } else {
        // Create new accessor usage entry
        accessorUsages.set(key, {
          accessorId,
          accessorNode: sourceNode,
          dataSourceId: dataEdge.source,
          dataSourceHandle: dataEdge.sourceHandle || 'out.data',
          layers: [{ layerId, fieldName, edgeId: edge.id }],
        })
      }
    }
  }

  if (accessorUsages.size === 0) {
    return project
  }

  const newNodes = [...nodes]
  const newEdges = [...edges]
  const nodesToRemove = new Set<string>()
  const edgesToRemove = new Set<string>()

  // Map: layerId -> list of CreateAttributeOp chains to apply
  const layerDataUpdates = new Map<string, { source: string; handle: string }>()

  // Process each unique accessor usage
  let createAttrIndex = 0
  for (const [key, usage] of accessorUsages) {
    const { accessorId, accessorNode, dataSourceId, dataSourceHandle, layers } = usage

    // Collect all attribute names needed for this accessor across all layers
    const attributeNames = new Set(
      layers.map(l => ACCESSOR_FIELD_TO_ATTRIBUTE[l.fieldName] || l.fieldName.replace('get', '').toLowerCase())
    )

    const expression = (accessorNode.data.inputs?.expression as string) || 'd'

    // Create ONE CreateAttributeOp per unique attribute name
    let currentDataSource = dataSourceId
    let currentDataHandle = dataSourceHandle

    for (const attributeName of attributeNames) {
      // Determine type/size based on attribute name
      const isColor = attributeName.includes('Color') || attributeName === 'color'
      const isPosition = attributeName === 'position' || attributeName === 'sourcePosition' || attributeName === 'targetPosition'

      const createAttrNodeId = `${accessorId.replace('/accessor-', '/attr-')}-${attributeName}`

      const createAttrNode = {
        id: createAttrNodeId,
        type: 'CreateAttributeOp',
        position: {
          x: accessorNode.position.x,
          y: accessorNode.position.y + createAttrIndex * 120,
        },
        data: {
          inputs: {
            name: attributeName,
            expression,
          },
        },
      }

      newNodes.push(createAttrNode)
      createAttrIndex++

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

      // Chain for next CreateAttributeOp (if multiple attributes from same accessor)
      currentDataSource = createAttrNodeId
      currentDataHandle = 'out.data'
    }

    // Update all layers using this accessor to read from the final CreateAttributeOp in chain
    for (const { layerId, edgeId } of layers) {
      layerDataUpdates.set(layerId, { source: currentDataSource, handle: currentDataHandle })
      edgesToRemove.add(edgeId)
    }

    // Mark accessor node for removal
    nodesToRemove.add(accessorId)
  }

  // Update layer data connections
  for (const [layerId, { source, handle }] of layerDataUpdates) {
    const layerDataEdgeIndex = newEdges.findIndex(
      e => e.target === layerId && e.targetHandle === 'par.data'
    )
    if (layerDataEdgeIndex >= 0) {
      const oldEdge = newEdges[layerDataEdgeIndex]
      newEdges[layerDataEdgeIndex] = {
        ...oldEdge,
        source,
        sourceHandle: handle,
        id: edgeId({
          source,
          target: layerId,
          sourceHandle: handle,
          targetHandle: 'par.data',
        }),
      }
    }
  }

  // Remove old accessor nodes and edges
  const filteredNodes = newNodes.filter(n => !nodesToRemove.has(n.id))
  const filteredEdges = newEdges.filter(e => !edgesToRemove.has(e.id))

  return {
    ...project,
    nodes: filteredNodes,
    edges: filteredEdges,
  }
}

export async function down(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  // Downgrade is not supported for this migration as it would require
  // converting attribute names back to accessor expressions, which may lose information
  return project
}
