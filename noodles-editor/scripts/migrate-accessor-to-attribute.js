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
 * Apply intelligent left-to-right layout with proper horizontal alignment
 * - OutOp on the far right
 * - Each dependency level aligned horizontally
 * - FileOps and data sources on the far left
 */
function applySmartLayout(nodes, edges) {
  const { graph, inDegree } = buildDependencyGraph(nodes, edges)

  // Calculate longest path to each node (reverse topological order)
  const longestPath = new Map()
  const reverseGraph = new Map()

  // Build reverse graph (target -> sources)
  for (const node of nodes) {
    reverseGraph.set(node.id, [])
    longestPath.set(node.id, 0)
  }

  for (const edge of edges) {
    if (reverseGraph.has(edge.target)) {
      reverseGraph.get(edge.target).push(edge.source)
    }
  }

  // Find nodes with no outgoing edges (sinks like OutOp, ViewerOp)
  const sinks = []
  for (const node of nodes) {
    const hasOutgoing = edges.some(e => e.source === node.id)
    if (!hasOutgoing) {
      sinks.push(node.id)
    }
  }

  // BFS from sinks to calculate longest path to each node
  const queue = [...sinks]
  const visited = new Set()

  for (const sink of sinks) {
    longestPath.set(sink, 0)
  }

  while (queue.length > 0) {
    const nodeId = queue.shift()
    if (visited.has(nodeId)) continue
    visited.add(nodeId)

    const currentPath = longestPath.get(nodeId)
    const parents = reverseGraph.get(nodeId) || []

    for (const parent of parents) {
      const newPath = currentPath + 1
      if (newPath > longestPath.get(parent)) {
        longestPath.set(parent, newPath)
      }
      if (!visited.has(parent)) {
        queue.push(parent)
      }
    }
  }

  // Group nodes by their layer (distance from sink)
  const maxLayer = Math.max(...Array.from(longestPath.values()))
  const layers = []

  for (let i = 0; i <= maxLayer; i++) {
    layers.push([])
  }

  for (const node of nodes) {
    const layer = maxLayer - longestPath.get(node.id)
    layers[layer].push(node.id)
  }

  // Calculate positions
  const HORIZONTAL_SPACING = 400
  const VERTICAL_SPACING = 200
  const START_X = 100
  const START_Y = 100

  const nodePositions = new Map()

  // Process each layer right-to-left (OutOp is in layer 0)
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
    const layerNodes = layers[layerIndex]
    const x = START_X + layerIndex * HORIZONTAL_SPACING

    // Sort nodes within layer for better vertical alignment
    // Group nodes by their downstream target for alignment
    const nodesByTarget = new Map()

    for (const nodeId of layerNodes) {
      const node = nodes.find(n => n.id === nodeId)
      if (!node) continue

      // Find immediate downstream nodes
      const downstreamEdges = edges.filter(e => e.source === nodeId)

      if (downstreamEdges.length === 1) {
        const target = downstreamEdges[0].target
        if (!nodesByTarget.has(target)) {
          nodesByTarget.set(target, [])
        }
        nodesByTarget.get(target).push({ nodeId, node })
      } else {
        // Multiple or no targets
        const key = `_multi_${nodeId}`
        if (!nodesByTarget.has(key)) {
          nodesByTarget.set(key, [])
        }
        nodesByTarget.get(key).push({ nodeId, node })
      }
    }

    // Assign vertical positions
    let currentY = START_Y

    for (const [targetId, group] of nodesByTarget) {
      // Try to align with target's Y position if available
      let alignY = currentY

      if (!targetId.startsWith('_multi_')) {
        const targetPos = nodePositions.get(targetId)
        if (targetPos && group.length === 1) {
          // Align single node with its target
          alignY = targetPos.y
        }
      }

      // Position nodes in this group
      for (const { nodeId, node } of group) {
        if (group.length === 1 && !targetId.startsWith('_multi_')) {
          // Single node aligned with target
          nodePositions.set(nodeId, { x, y: alignY })
        } else {
          // Stack multiple nodes
          nodePositions.set(nodeId, { x, y: currentY })
          const size = getNodeSize(node.type)
          currentY += size.height + VERTICAL_SPACING
        }
      }

      // Update currentY for next group
      if (group.length === 1 && !targetId.startsWith('_multi_')) {
        const size = getNodeSize(group[0].node.type)
        currentY = Math.max(currentY, alignY + size.height + VERTICAL_SPACING)
      }
    }
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
