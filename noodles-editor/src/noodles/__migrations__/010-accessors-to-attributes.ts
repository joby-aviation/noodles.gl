import type { NoodlesProjectJSON } from '../utils/serialization'

/**
 * Migration 010: Convert AccessorOp patterns to CreateAttributeOp
 *
 * This migration detects AccessorOp nodes connected to layer operators
 * and converts them to CreateAttributeOp nodes with binary attributes.
 *
 * Pattern detected:
 *   DataSource → AccessorOp → LayerOp.get[Accessor]
 *
 * Converted to:
 *   DataSource → CreateAttributeOp → LayerOp.data
 *
 * This enables 10-100x performance improvements using deck.gl's binary data API.
 */

// Map accessor field names to attribute names and data types
const ACCESSOR_TO_ATTRIBUTE: Record<
  string,
  { attributeName: string; dataType: 'float' | 'vec2' | 'vec3' | 'rgba' }
> = {
  getPosition: { attributeName: 'position', dataType: 'vec2' },
  getSourcePosition: { attributeName: 'sourcePosition', dataType: 'vec2' },
  getTargetPosition: { attributeName: 'targetPosition', dataType: 'vec2' },
  getFillColor: { attributeName: 'fillColor', dataType: 'rgba' },
  getLineColor: { attributeName: 'lineColor', dataType: 'rgba' },
  getColor: { attributeName: 'color', dataType: 'rgba' },
  getSourceColor: { attributeName: 'sourceColor', dataType: 'rgba' },
  getTargetColor: { attributeName: 'targetColor', dataType: 'rgba' },
  getRadius: { attributeName: 'radius', dataType: 'float' },
  getWidth: { attributeName: 'width', dataType: 'float' },
  getLineWidth: { attributeName: 'lineWidth', dataType: 'float' },
  getElevation: { attributeName: 'elevation', dataType: 'float' },
  getSize: { attributeName: 'size', dataType: 'float' },
  getAngle: { attributeName: 'angle', dataType: 'float' },
  getScale: { attributeName: 'scale', dataType: 'vec3' },
  getOrientation: { attributeName: 'orientation', dataType: 'vec3' },
  getTranslation: { attributeName: 'translation', dataType: 'vec3' },
  getNormal: { attributeName: 'normal', dataType: 'vec3' },
  getPixelOffset: { attributeName: 'pixelOffset', dataType: 'vec2' },
}

// Layer operators that support binary attributes
const BINARY_ATTRIBUTE_LAYERS = new Set([
  'ScatterplotLayerOp',
  'PathLayerOp',
  'ArcLayerOp',
  'LineLayerOp',
  'ColumnLayerOp',
  'PolygonLayerOp',
  'GeoJsonLayerOp',
  'IconLayerOp',
  'TextLayerOp',
  'PointCloudLayerOp',
])

interface AccessorConnection {
  accessorNodeId: string
  layerNodeId: string
  accessorField: string
  dataSourceId: string
  expression: string
}

export async function up(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  const nodes = [...project.nodes]
  const edges = [...project.edges]

  // Step 1: Find all AccessorOp nodes
  const accessorNodes = nodes.filter(n => n.type === 'AccessorOp')
  if (accessorNodes.length === 0) {
    return project // Nothing to migrate
  }

  console.log(`[Migration 010] Found ${accessorNodes.length} AccessorOp nodes`)

  // Step 2: Find AccessorOp → Layer connections
  const accessorConnections: AccessorConnection[] = []

  for (const accessorNode of accessorNodes) {
    const outgoingEdges = edges.filter(e => e.source === accessorNode.id)

    for (const edge of outgoingEdges) {
      const targetNode = nodes.find(n => n.id === edge.target)
      if (!targetNode || !BINARY_ATTRIBUTE_LAYERS.has(targetNode.type)) {
        continue
      }

      const targetField = edge.targetHandle?.replace('par.', '') || ''
      if (!ACCESSOR_TO_ATTRIBUTE[targetField]) {
        console.warn(
          `[Migration 010] Skipping ${accessorNode.id} → ${targetNode.id}.${targetField}: unknown accessor`
        )
        continue
      }

      const accessorDataEdge = edges.find(
        e => e.target === accessorNode.id && e.targetHandle === 'par.data'
      )
      if (!accessorDataEdge) {
        console.warn(`[Migration 010] Skipping ${accessorNode.id}: no data source`)
        continue
      }

      const expression = accessorNode.data?.inputs?.expression || ''
      if (!expression) {
        console.warn(`[Migration 010] Skipping ${accessorNode.id}: empty expression`)
        continue
      }

      accessorConnections.push({
        accessorNodeId: accessorNode.id,
        layerNodeId: targetNode.id,
        accessorField: targetField,
        dataSourceId: accessorDataEdge.source,
        expression,
      })
    }
  }

  if (accessorConnections.length === 0) {
    console.log('[Migration 010] No accessor connections found')
    return project
  }

  console.log(`[Migration 010] Migrating ${accessorConnections.length} accessor connections`)

  // Step 3: Create CreateAttributeOp nodes
  const nodesToRemove = new Set<string>()
  const edgesToRemove = new Set<string>()
  const processedAccessors = new Set<string>()

  for (const conn of accessorConnections) {
    if (processedAccessors.has(conn.accessorNodeId)) {
      continue
    }

    const attrConfig = ACCESSOR_TO_ATTRIBUTE[conn.accessorField]
    const createAttrNodeId = `${conn.accessorNodeId}-attr`

    const accessorNode = nodes.find(n => n.id === conn.accessorNodeId)
    const position = accessorNode?.position || { x: 0, y: 0 }

    // Create CreateAttributeOp node
    nodes.push({
      id: createAttrNodeId,
      type: 'CreateAttributeOp',
      position: { x: position.x, y: position.y + 80 },
      data: {
        inputs: {
          attributeName: attrConfig.attributeName,
          expression: conn.expression,
          dataType: attrConfig.dataType,
        },
      },
    })

    // Connect data source → CreateAttributeOp
    const dataSourceEdge = edges.find(
      e => e.target === conn.accessorNodeId && e.targetHandle === 'par.data'
    )
    if (dataSourceEdge) {
      edgesToRemove.add(dataSourceEdge.id)
      edges.push({
        id: `${dataSourceEdge.source}.out.data->${createAttrNodeId}.par.data`,
        source: dataSourceEdge.source,
        target: createAttrNodeId,
        sourceHandle: dataSourceEdge.sourceHandle,
        targetHandle: 'par.data',
      })
    }

    // Connect CreateAttributeOp → Layer.data
    const layerEdge = edges.find(
      e => e.source === conn.accessorNodeId && e.target === conn.layerNodeId
    )
    if (layerEdge) {
      edgesToRemove.add(layerEdge.id)
      edges.push({
        id: `${createAttrNodeId}.out.data->${conn.layerNodeId}.par.data`,
        source: createAttrNodeId,
        target: conn.layerNodeId,
        sourceHandle: 'out.data',
        targetHandle: 'par.data',
      })
    }

    nodesToRemove.add(conn.accessorNodeId)
    processedAccessors.add(conn.accessorNodeId)

    console.log(
      `[Migration 010] Migrated ${conn.accessorNodeId} → ${createAttrNodeId} (${conn.accessorField})`
    )
  }

  // Step 4: Clean up
  const finalNodes = nodes.filter(n => !nodesToRemove.has(n.id))
  const finalEdges = edges.filter(e => !edgesToRemove.has(e.id))

  console.log(`[Migration 010] Complete. Removed ${nodesToRemove.size} AccessorOp nodes`)

  return {
    ...project,
    nodes: finalNodes,
    edges: finalEdges,
  }
}

export async function down(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  const nodes = [...project.nodes]
  const edges = [...project.edges]

  // Find all CreateAttributeOp nodes that were created by this migration
  const createAttrNodes = nodes.filter(n => n.type === 'CreateAttributeOp')
  if (createAttrNodes.length === 0) {
    return project
  }

  console.log(`[Migration 010 down] Found ${createAttrNodes.length} CreateAttributeOp nodes`)

  // Map attribute names back to accessor field names
  const ATTRIBUTE_TO_ACCESSOR: Record<string, string> = {}
  for (const [accessor, config] of Object.entries(ACCESSOR_TO_ATTRIBUTE)) {
    ATTRIBUTE_TO_ACCESSOR[config.attributeName] = accessor
  }

  const nodesToRemove = new Set<string>()
  const edgesToRemove = new Set<string>()

  for (const createAttrNode of createAttrNodes) {
    const attributeName = createAttrNode.data?.inputs?.attributeName
    const expression = createAttrNode.data?.inputs?.expression
    if (!attributeName || !expression) {
      continue
    }

    const accessorField = ATTRIBUTE_TO_ACCESSOR[attributeName]
    if (!accessorField) {
      continue
    }

    // Find the layer this CreateAttributeOp connects to
    const layerEdge = edges.find(
      e => e.source === createAttrNode.id && e.targetHandle === 'par.data'
    )
    if (!layerEdge) {
      continue
    }

    // Find the data source
    const dataSourceEdge = edges.find(
      e => e.target === createAttrNode.id && e.targetHandle === 'par.data'
    )
    if (!dataSourceEdge) {
      continue
    }

    const accessorNodeId = createAttrNode.id.replace('-attr', '')
    const position = createAttrNode.position || { x: 0, y: 0 }

    // Create AccessorOp node
    nodes.push({
      id: accessorNodeId,
      type: 'AccessorOp',
      position: { x: position.x, y: position.y - 80 },
      data: {
        inputs: {
          expression,
        },
      },
    })

    // Connect data source → AccessorOp
    edgesToRemove.add(dataSourceEdge.id)
    edges.push({
      id: `${dataSourceEdge.source}.out.data->${accessorNodeId}.par.data`,
      source: dataSourceEdge.source,
      target: accessorNodeId,
      sourceHandle: dataSourceEdge.sourceHandle,
      targetHandle: 'par.data',
    })

    // Connect AccessorOp → Layer.accessor
    edgesToRemove.add(layerEdge.id)
    edges.push({
      id: `${accessorNodeId}.out.accessor->${layerEdge.target}.par.${accessorField}`,
      source: accessorNodeId,
      target: layerEdge.target,
      sourceHandle: 'out.accessor',
      targetHandle: `par.${accessorField}`,
    })

    nodesToRemove.add(createAttrNode.id)

    console.log(`[Migration 010 down] Reverted ${createAttrNode.id} → ${accessorNodeId}`)
  }

  const finalNodes = nodes.filter(n => !nodesToRemove.has(n.id))
  const finalEdges = edges.filter(e => !edgesToRemove.has(e.id))

  console.log(`[Migration 010 down] Complete. Removed ${nodesToRemove.size} CreateAttributeOp nodes`)

  return {
    ...project,
    nodes: finalNodes,
    edges: finalEdges,
  }
}
