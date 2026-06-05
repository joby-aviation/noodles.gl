#!/usr/bin/env node

/**
 * Auto-layout nodes in example JSON files to prevent overlaps
 * Uses a simple hierarchical layout based on graph topology
 */

const fs = require('fs')
const path = require('path')

// Layout configuration
const NODE_WIDTH = 280
const BASE_NODE_HEIGHT = 80 // Minimum height for collapsed nodes
const FIELD_HEIGHT = 28 // Height per input/output field
const NODE_PADDING = 40 // Extra padding (header, footer, margins)
const HORIZONTAL_SPACING = 200
const MIN_VERTICAL_SPACING = 80 // Minimum gap between nodes
const START_X = 100
const START_Y = 100

/**
 * Estimate node height based on inputs/outputs
 * This is approximate - actual heights vary by operator type
 */
function estimateNodeHeight(node) {
  const inputCount = node.data?.inputs ? Object.keys(node.data.inputs).length : 0
  // Most nodes show ~5-8 fields when expanded, minimum is collapsed height
  const visibleFields = Math.max(3, Math.min(inputCount, 8))
  return BASE_NODE_HEIGHT + visibleFields * FIELD_HEIGHT + NODE_PADDING
}

/**
 * Build a dependency graph from edges
 */
function buildDependencyGraph(nodes, edges) {
  const graph = new Map()
  const inDegree = new Map()

  // Initialize
  for (const node of nodes) {
    graph.set(node.id, [])
    inDegree.set(node.id, 0)
  }

  // Build adjacency list and calculate in-degrees
  for (const edge of edges) {
    if (graph.has(edge.source) && graph.has(edge.target)) {
      graph.get(edge.source).push(edge.target)
      inDegree.set(edge.target, inDegree.get(edge.target) + 1)
    }
  }

  return { graph, inDegree }
}

/**
 * Topological sort to determine node layers (Kahn's algorithm)
 */
function calculateNodeLayers(nodes, edges) {
  const { graph, inDegree } = buildDependencyGraph(nodes, edges)
  const layers = []
  const nodeToLayer = new Map()

  // Start with nodes that have no dependencies
  let currentLayer = []
  for (const [nodeId, degree] of inDegree.entries()) {
    if (degree === 0) {
      currentLayer.push(nodeId)
      nodeToLayer.set(nodeId, 0)
    }
  }

  let layerIndex = 0
  while (currentLayer.length > 0) {
    layers.push([...currentLayer])
    const nextLayer = []

    for (const nodeId of currentLayer) {
      const neighbors = graph.get(nodeId) || []
      for (const neighbor of neighbors) {
        const newDegree = inDegree.get(neighbor) - 1
        inDegree.set(neighbor, newDegree)

        if (newDegree === 0) {
          nextLayer.push(neighbor)
          nodeToLayer.set(neighbor, layerIndex + 1)
        }
      }
    }

    currentLayer = nextLayer
    layerIndex++
  }

  // Handle cycles or disconnected nodes - assign remaining nodes to last layer
  const assignedNodes = new Set(nodeToLayer.keys())
  const unassignedNodes = nodes.filter(n => !assignedNodes.has(n.id))
  if (unassignedNodes.length > 0) {
    const lastLayer = unassignedNodes.map(n => n.id)
    layers.push(lastLayer)
    for (const nodeId of lastLayer) {
      nodeToLayer.set(nodeId, layers.length - 1)
    }
  }

  return { layers, nodeToLayer }
}

/**
 * Calculate positions for nodes based on layers with size-aware spacing
 */
function calculateNodePositions(nodes, edges) {
  const { layers, nodeToLayer } = calculateNodeLayers(nodes, edges)
  const positions = new Map()

  // Build node lookup map
  const nodeMap = new Map(nodes.map(n => [n.id, n]))

  // Calculate positions layer by layer
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
    const layer = layers[layerIndex]

    // Calculate X position for this layer
    const x = START_X + layerIndex * (NODE_WIDTH + HORIZONTAL_SPACING)

    // Calculate Y positions with size-aware spacing
    let currentY = START_Y

    for (let i = 0; i < layer.length; i++) {
      const nodeId = layer[i]
      const node = nodeMap.get(nodeId)

      if (!node) {
        // Fallback for missing nodes
        positions.set(nodeId, { x, y: currentY })
        currentY += BASE_NODE_HEIGHT + MIN_VERTICAL_SPACING
        continue
      }

      // Place node at current Y
      positions.set(nodeId, { x, y: currentY })

      // Calculate this node's height and advance Y for next node
      const nodeHeight = estimateNodeHeight(node)
      currentY += nodeHeight + MIN_VERTICAL_SPACING
    }
  }

  return positions
}

/**
 * Update node positions in a project JSON
 */
function layoutProject(projectData) {
  if (!projectData.nodes || !projectData.edges) {
    console.warn('  Project missing nodes or edges, skipping')
    return projectData
  }

  const positions = calculateNodePositions(projectData.nodes, projectData.edges)

  // Update node positions
  const updatedNodes = projectData.nodes.map(node => ({
    ...node,
    position: positions.get(node.id) || node.position || { x: 0, y: 0 }
  }))

  return {
    ...projectData,
    nodes: updatedNodes
  }
}

/**
 * Process all example files
 */
function processExamples() {
  // Process both public/examples and src/examples
  const examplesDirs = [
    path.join(__dirname, '../noodles-editor/public/examples'),
    path.join(__dirname, '../noodles-editor/src/examples')
  ]

  let totalFiles = 0

  for (const examplesDir of examplesDirs) {
    if (!fs.existsSync(examplesDir)) {
      console.log(`Skipping ${examplesDir} (not found)`)
      continue
    }

    console.log(`\nProcessing directory: ${examplesDir}`)

    // For src/examples, look in subdirectories
    const isSourceExamples = examplesDir.includes('src/examples')
    let filesToProcess = []

    if (isSourceExamples) {
      const subdirs = fs.readdirSync(examplesDir).filter(f => {
        const fullPath = path.join(examplesDir, f)
        return fs.statSync(fullPath).isDirectory()
      })

      for (const subdir of subdirs) {
        const noodlesPath = path.join(examplesDir, subdir, 'noodles.json')
        if (fs.existsSync(noodlesPath)) {
          filesToProcess.push({ name: `${subdir}/noodles.json`, path: noodlesPath })
        }
      }
    } else {
      const files = fs.readdirSync(examplesDir).filter(f => f.endsWith('.json'))
      filesToProcess = files.map(f => ({ name: f, path: path.join(examplesDir, f) }))
    }

    console.log(`Found ${filesToProcess.length} example files\n`)
    totalFiles += filesToProcess.length

    for (const { name, path: filePath } of filesToProcess) {
      console.log(`Processing: ${name}`)

      try {
        const content = fs.readFileSync(filePath, 'utf8')
        const projectData = JSON.parse(content)

        // Some older examples don't have version field
        if (!projectData.nodes) {
          console.warn(`  Skipping ${name}: not a valid project file`)
          continue
        }

      const layoutedData = layoutProject(projectData)

      // Calculate layers for reporting
      const { layers } = calculateNodeLayers(layoutedData.nodes, layoutedData.edges)

      // Write back with nice formatting
      fs.writeFileSync(
        filePath,
        JSON.stringify(layoutedData, null, 2) + '\n',
        'utf8'
      )

        console.log(`  ✓ Layouted ${layoutedData.nodes?.length || 0} nodes in ${layers.length} layers`)
      } catch (error) {
        console.error(`  ✗ Error processing ${name}:`, error.message)
      }
    }
  }

  console.log(`\nDone! Processed ${totalFiles} example files.`)
}

// Run if called directly
if (require.main === module) {
  processExamples()
}

module.exports = { layoutProject, calculateNodePositions, calculateNodeLayers }
