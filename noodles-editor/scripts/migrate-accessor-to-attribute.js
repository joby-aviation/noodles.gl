#!/usr/bin/env node

/**
 * Migration Script: Convert AccessorOp to CreateAttributeOp
 *
 * This script:
 * 1. Finds all AccessorOp nodes in example projects
 * 2. Converts them to CreateAttributeOp with proper data flow
 * 3. Applies intelligent left-to-right layout with vertical alignment
 * 4. Handles branching and node size awareness
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const EXAMPLES_DIR = path.join(__dirname, '../src/examples')
const DRY_RUN = process.argv.includes('--dry-run')

// Node size estimates (width x height in pixels)
const NODE_SIZES = {
  FileOp: { width: 200, height: 150 },
  CreateAttributeOp: { width: 250, height: 180 },
  ScatterplotLayerOp: { width: 250, height: 300 },
  PathLayerOp: { width: 250, height: 280 },
  ArcLayerOp: { width: 250, height: 280 },
  IconLayerOp: { width: 250, height: 260 },
  TextLayerOp: { width: 250, height: 280 },
  GeoJsonLayerOp: { width: 250, height: 300 },
  PolygonLayerOp: { width: 250, height: 300 },
  H3HexagonLayerOp: { width: 250, height: 280 },
  HeatmapLayerOp: { width: 250, height: 260 },
  ColumnLayerOp: { width: 250, height: 280 },
  DeckRendererOp: { width: 220, height: 120 },
  MaplibreBasemapOp: { width: 220, height: 200 },
  OutOp: { width: 150, height: 80 },
  AccessorOp: { width: 200, height: 100 },
  ColorRampOp: { width: 220, height: 150 },
  MapRangeOp: { width: 200, height: 180 },
  MathOp: { width: 180, height: 150 },
  default: { width: 200, height: 150 }
}

function getNodeSize(nodeType) {
  return NODE_SIZES[nodeType] || NODE_SIZES.default
}

/**
 * Parse accessor expression to determine attribute name and configuration
 */
function parseAccessorExpression(expression, targetField) {
  const expr = expression.trim()

  // Detect position accessors
  if (expr.match(/\[.*lng.*lat.*\]/) || expr.match(/\[.*lon.*lat.*\]/i) || targetField === 'getPosition') {
    return {
      name: 'position',
      expression: expr,
      size: 3,
      type: 'float'
    }
  }

  // Detect color accessors (returns array)
  if (expr.includes('color') || expr.includes('rgb') || expr.includes('255') || targetField.includes('Color')) {
    return {
      name: targetField.replace('get', '').toLowerCase(),
      expression: expr,
      size: 4,
      type: 'uint8'
    }
  }

  // Detect radius/size accessors
  if (targetField === 'getRadius' || targetField === 'getSize' || targetField === 'getWidth') {
    return {
      name: targetField.replace('get', '').toLowerCase(),
      expression: expr,
      size: 1,
      type: 'float'
    }
  }

  // Default: single float value
  return {
    name: targetField.replace('get', '').toLowerCase() || 'value',
    expression: expr,
    size: 1,
    type: 'float'
  }
}

/**
 * Convert AccessorOp to CreateAttributeOp
 */
function convertAccessorNode(accessorNode, downstreamEdges, allNodes) {
  const expression = accessorNode.data.inputs.expression || 'd.value'

  // Find what this accessor connects to
  const targetEdges = downstreamEdges.filter(e => e.source === accessorNode.id)

  // Determine attribute configuration based on downstream usage
  let attributeConfig = null

  for (const edge of targetEdges) {
    const targetField = edge.targetHandle?.replace('par.', '') || ''
    const config = parseAccessorExpression(expression, targetField)

    if (!attributeConfig || config.size > attributeConfig.size) {
      attributeConfig = config
    }
  }

  if (!attributeConfig) {
    attributeConfig = {
      name: 'value',
      expression,
      size: 1,
      type: 'float'
    }
  }

  // Create new CreateAttributeOp node
  return {
    id: accessorNode.id.replace('-accessor', ''),
    type: 'CreateAttributeOp',
    position: accessorNode.position,
    data: {
      inputs: {
        name: attributeConfig.name,
        expression: attributeConfig.expression,
        size: attributeConfig.size,
        type: attributeConfig.type
      },
      locked: accessorNode.data.locked || false
    }
  }
}

/**
 * Build dependency graph for topological sort
 */
function buildDependencyGraph(nodes, edges) {
  const graph = new Map()
  const inDegree = new Map()

  // Initialize
  for (const node of nodes) {
    graph.set(node.id, [])
    inDegree.set(node.id, 0)
  }

  // Build adjacency list
  for (const edge of edges) {
    if (graph.has(edge.source) && graph.has(edge.target)) {
      graph.get(edge.source).push(edge.target)
      inDegree.set(edge.target, inDegree.get(edge.target) + 1)
    }
  }

  return { graph, inDegree }
}

/**
 * Apply intelligent left-to-right layout with vertical alignment
 */
function applySmartLayout(nodes, edges) {
  const { graph, inDegree } = buildDependencyGraph(nodes, edges)

  // Topological sort to determine horizontal layers
  const layers = []
  const nodeToLayer = new Map()
  const queue = []
  const inDegreeClone = new Map(inDegree)

  // Start with nodes that have no dependencies
  for (const [nodeId, degree] of inDegreeClone) {
    if (degree === 0) {
      queue.push(nodeId)
    }
  }

  let currentLayer = 0
  while (queue.length > 0) {
    const layerSize = queue.length
    const currentLayerNodes = []

    for (let i = 0; i < layerSize; i++) {
      const nodeId = queue.shift()
      currentLayerNodes.push(nodeId)
      nodeToLayer.set(nodeId, currentLayer)

      // Process downstream nodes
      const neighbors = graph.get(nodeId) || []
      for (const neighbor of neighbors) {
        const newDegree = inDegreeClone.get(neighbor) - 1
        inDegreeClone.set(neighbor, newDegree)
        if (newDegree === 0) {
          queue.push(neighbor)
        }
      }
    }

    layers.push(currentLayerNodes)
    currentLayer++
  }

  // Calculate vertical positions with alignment
  const HORIZONTAL_SPACING = 400
  const VERTICAL_SPACING = 200
  const VERTICAL_ALIGNMENT_THRESHOLD = 150

  const nodePositions = new Map()
  const layerHeights = new Map()

  // Process each layer
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
    const layerNodes = layers[layerIndex]
    const x = layerIndex * HORIZONTAL_SPACING + 100

    // Group nodes by their upstream parent (for vertical alignment)
    const nodeGroups = new Map()

    for (const nodeId of layerNodes) {
      const node = nodes.find(n => n.id === nodeId)
      if (!node) continue

      // Find upstream parent(s)
      const upstreamEdges = edges.filter(e => e.target === nodeId)

      if (upstreamEdges.length === 1) {
        // Single parent - candidate for vertical alignment
        const parentId = upstreamEdges[0].source
        if (!nodeGroups.has(parentId)) {
          nodeGroups.set(parentId, [])
        }
        nodeGroups.get(parentId).push({ nodeId, node })
      } else {
        // Multiple parents or no parent - separate group
        nodeGroups.set(`_orphan_${nodeId}`, [{ nodeId, node }])
      }
    }

    // Calculate positions for each group
    let currentY = 100

    for (const [parentId, group] of nodeGroups) {
      if (group.length === 1 && parentId !== `_orphan_${group[0].nodeId}`) {
        // Single child - try to align with parent
        const parentPos = nodePositions.get(parentId)
        if (parentPos) {
          const y = parentPos.y
          nodePositions.set(group[0].nodeId, { x, y })
          const size = getNodeSize(group[0].node.type)
          currentY = Math.max(currentY, y + size.height + VERTICAL_SPACING)
        } else {
          nodePositions.set(group[0].nodeId, { x, y: currentY })
          const size = getNodeSize(group[0].node.type)
          currentY += size.height + VERTICAL_SPACING
        }
      } else {
        // Multiple children or orphan - stack vertically
        for (const { nodeId, node } of group) {
          nodePositions.set(nodeId, { x, y: currentY })
          const size = getNodeSize(node.type)
          currentY += size.height + VERTICAL_SPACING
        }
      }
    }

    layerHeights.set(layerIndex, currentY)
  }

  // Apply positions to nodes
  const updatedNodes = nodes.map(node => {
    const pos = nodePositions.get(node.id)
    if (pos) {
      return {
        ...node,
        position: { x: pos.x, y: pos.y }
      }
    }
    return node
  })

  return updatedNodes
}

/**
 * Migrate a single project file
 */
function migrateProject(projectPath) {
  const content = fs.readFileSync(projectPath, 'utf-8')
  const project = JSON.parse(content)

  // Find all AccessorOp nodes
  const accessorNodes = project.nodes.filter(n => n.type === 'AccessorOp')

  if (accessorNodes.length === 0) {
    return { migrated: false, accessorCount: 0 }
  }

  console.log(`  Found ${accessorNodes.length} AccessorOp node(s)`)

  let newNodes = [...project.nodes]
  let newEdges = [...project.edges]

  // Convert each AccessorOp
  for (const accessorNode of accessorNodes) {
    const downstreamEdges = newEdges.filter(e => e.source === accessorNode.id)

    // Find upstream data source
    const upstreamEdge = newEdges.find(e => e.target === accessorNode.id && e.targetHandle === 'par.expression')
    const dataSourceEdge = newEdges.find(e => e.target === accessorNode.id && !e.targetHandle.includes('expression'))

    // Convert to CreateAttributeOp
    const createAttrNode = convertAccessorNode(accessorNode, downstreamEdges, newNodes)

    console.log(`  Converting ${accessorNode.id} -> ${createAttrNode.id} (CreateAttributeOp)`)
    console.log(`    Attribute: ${createAttrNode.data.inputs.name} (size: ${createAttrNode.data.inputs.size}, type: ${createAttrNode.data.inputs.type})`)

    // Replace node
    newNodes = newNodes.filter(n => n.id !== accessorNode.id)
    newNodes.push(createAttrNode)

    // Update edges
    // 1. Remove old accessor output edges
    newEdges = newEdges.filter(e => e.source !== accessorNode.id)

    // 2. Update/create data input edge for CreateAttributeOp
    if (dataSourceEdge) {
      newEdges = newEdges.filter(e => e.id !== dataSourceEdge.id)
      newEdges.push({
        id: `${dataSourceEdge.source}.out.data->${createAttrNode.id}.par.data`,
        source: dataSourceEdge.source,
        sourceHandle: 'out.data',
        target: createAttrNode.id,
        targetHandle: 'par.data'
      })
    }

    // 3. Connect CreateAttributeOp output to downstream consumers
    // CreateAttributeOp outputs attribute-enhanced data, not accessor functions
    for (const downstreamEdge of downstreamEdges) {
      // Find the target node
      const targetNode = newNodes.find(n => n.id === downstreamEdge.target)

      if (targetNode) {
        if (targetNode.type.includes('Layer')) {
          // Connect data output to layer's data input
          newEdges.push({
            id: `${createAttrNode.id}.out.data->${downstreamEdge.target}.par.data`,
            source: createAttrNode.id,
            sourceHandle: 'out.data',
            target: downstreamEdge.target,
            targetHandle: 'par.data'
          })
        } else if (targetNode.type === 'MapRangeOp' || targetNode.type === 'ColorRampOp' ||
                   targetNode.type === 'MathOp' || targetNode.type === 'ExtentOp') {
          // These operators work on accessors, but we can chain CreateAttributeOps instead
          // For now, skip these connections - they should be replaced with direct attribute creation
          console.log(`    ⚠️  Skipping ${targetNode.type} connection - use direct attribute computation instead`)
        } else {
          // For other consumers, try to connect as data
          newEdges.push({
            id: `${createAttrNode.id}.out.data->${downstreamEdge.target}.par.data`,
            source: createAttrNode.id,
            sourceHandle: 'out.data',
            target: downstreamEdge.target,
            targetHandle: 'par.data'
          })
        }
      }
    }

    // 4. Remove old accessor input edges
    newEdges = newEdges.filter(e => e.target !== accessorNode.id)
  }

  // Apply smart layout
  newNodes = applySmartLayout(newNodes, newEdges)

  // Update project
  const migratedProject = {
    ...project,
    nodes: newNodes,
    edges: newEdges
  }

  if (!DRY_RUN) {
    fs.writeFileSync(projectPath, JSON.stringify(migratedProject, null, 2))
  }

  return { migrated: true, accessorCount: accessorNodes.length }
}

/**
 * Main migration function
 */
function main() {
  console.log('🔄 AccessorOp → CreateAttributeOp Migration')
  console.log('==========================================\n')

  if (DRY_RUN) {
    console.log('⚠️  DRY RUN MODE - No files will be modified\n')
  }

  // Find all example projects
  const examples = fs.readdirSync(EXAMPLES_DIR)
    .filter(dir => {
      const fullPath = path.join(EXAMPLES_DIR, dir)
      return fs.statSync(fullPath).isDirectory()
    })

  let totalMigrated = 0
  let totalAccessors = 0
  const migratedProjects = []

  for (const example of examples) {
    const projectPath = path.join(EXAMPLES_DIR, example, 'noodles.json')

    if (!fs.existsSync(projectPath)) {
      continue
    }

    console.log(`📁 ${example}`)

    try {
      const result = migrateProject(projectPath)

      if (result.migrated) {
        totalMigrated++
        totalAccessors += result.accessorCount
        migratedProjects.push(example)
        console.log(`  ✅ Migrated ${result.accessorCount} AccessorOp(s)\n`)
      } else {
        console.log(`  ⏭️  No AccessorOps found\n`)
      }
    } catch (error) {
      console.error(`  ❌ Error: ${error.message}\n`)
    }
  }

  // Summary
  console.log('\n==========================================')
  console.log('📊 Migration Summary')
  console.log('==========================================')
  console.log(`Projects scanned: ${examples.length}`)
  console.log(`Projects migrated: ${totalMigrated}`)
  console.log(`Total AccessorOps converted: ${totalAccessors}`)

  if (migratedProjects.length > 0) {
    console.log('\n✅ Migrated projects:')
    for (const project of migratedProjects) {
      console.log(`  - ${project}`)
    }
  }

  if (DRY_RUN) {
    console.log('\n⚠️  DRY RUN - Run without --dry-run to apply changes')
  } else {
    console.log('\n✨ Migration complete!')
  }
}

main()
