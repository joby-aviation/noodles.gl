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

  // Map: layerId -> array of CreateAttributeOp chain endpoints
  const layerDataChains = new Map<string, Array<{ source: string; handle: string }>>()

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

      // Infer size and type from attribute name
      const inputs: Record<string, unknown> = {
        name: attributeName,
        expression,
      }

      // Position attributes need size 2 or 3 (x,y or x,y,z)
      if (isPosition) {
        // Check if expression looks like it has 3 components (e.g., [x, y, z])
        const has3Components = /\[.*,.*,.*\]/.test(expression)
        inputs.size = has3Components ? 3 : 2
      }

      // Color attributes need size 4 (RGBA) and type uint8
      if (isColor) {
        inputs.size = 4
        inputs.type = 'uint8'
      }

      const createAttrNode = {
        id: createAttrNodeId,
        type: 'CreateAttributeOp',
        position: {
          x: accessorNode.position.x,
          y: accessorNode.position.y + createAttrIndex * 120,
        },
        data: {
          inputs,
        },
      }

      newNodes.push(createAttrNode)
      console.log('[Migration 015] Created node:', JSON.stringify(createAttrNode, null, 2))
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

    // Track all layers using this accessor and map them to the correct CreateAttributeOp
    // Each layer needs a specific attribute, not necessarily the last one in the chain
    const attributeNameToNodeId = new Map<string, string>()
    for (const attributeName of attributeNames) {
      const nodeId = `${accessorId.replace('/accessor-', '/attr-')}-${attributeName}`
      attributeNameToNodeId.set(attributeName, nodeId)
    }

    for (const { layerId, fieldName, edgeId } of layers) {
      const attributeName = ACCESSOR_FIELD_TO_ATTRIBUTE[fieldName] || fieldName.replace('get', '').toLowerCase()
      const createAttrNodeId = attributeNameToNodeId.get(attributeName)

      if (createAttrNodeId) {
        const existing = layerDataChains.get(layerId) || []
        existing.push({ source: createAttrNodeId, handle: 'out.data' })
        layerDataChains.set(layerId, existing)
        edgesToRemove.add(edgeId)
      }
    }

    // Mark accessor node for removal
    nodesToRemove.add(accessorId)
  }

  // For each layer, chain all its CreateAttributeOps together
  const layerDataUpdates = new Map<string, { source: string; handle: string }>()
  for (const [layerId, chains] of layerDataChains) {
    if (chains.length === 1) {
      // Single chain, use it directly
      layerDataUpdates.set(layerId, chains[0])
    } else {
      // Multiple chains - need to merge them by chaining them together
      // The first chain starts from the data source
      // Each subsequent chain should read from the previous chain's output
      let finalSource = chains[0].source
      let finalHandle = chains[0].handle

      for (let i = 1; i < chains.length; i++) {
        // Get the CreateAttributeOp at the end of this chain
        const chainEndNode = newNodes.find(n => n.id === chains[i].source)
        if (chainEndNode && chainEndNode.type === 'CreateAttributeOp') {
          // Update its data input to come from the previous chain
          const existingDataEdgeIndex = newEdges.findIndex(
            e => e.target === chains[i].source && e.targetHandle === 'par.data'
          )
          if (existingDataEdgeIndex >= 0) {
            newEdges[existingDataEdgeIndex] = {
              ...newEdges[existingDataEdgeIndex],
              source: finalSource,
              sourceHandle: finalHandle,
              id: edgeId({
                source: finalSource,
                target: chains[i].source,
                sourceHandle: finalHandle,
                targetHandle: 'par.data',
              }),
            }
          }
          finalSource = chains[i].source
          finalHandle = chains[i].handle
        }
      }

      layerDataUpdates.set(layerId, { source: finalSource, handle: finalHandle })
    }
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
