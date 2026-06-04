#!/usr/bin/env node

/**
 * Auto-layout nodes in example JSON files to prevent overlaps
 * Uses a simple hierarchical layout based on graph topology
 */

const fs = require('fs')
const path = require('path')

// Layout configuration
const NODE_WIDTH = 300
const NODE_HEIGHT = 200
const HORIZONTAL_SPACING = 250
const VERTICAL_SPACING = 250
const START_X = 100
const START_Y = 100

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
 * Calculate positions for nodes based on layers
 */
function calculateNodePositions(nodes, edges) {
  const { layers, nodeToLayer } = calculateNodeLayers(nodes, edges)
  const positions = new Map()

  // Calculate positions layer by layer
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
    const layer = layers[layerIndex]
    const layerNodeCount = layer.length

    // Calculate X position for this layer
    const x = START_X + layerIndex * (NODE_WIDTH + HORIZONTAL_SPACING)

    // Center nodes vertically in their layer
    const totalLayerHeight = layerNodeCount * NODE_HEIGHT + (layerNodeCount - 1) * VERTICAL_SPACING
    const startY = START_Y

    for (let i = 0; i < layerNodeCount; i++) {
      const nodeId = layer[i]
      const y = startY + i * (NODE_HEIGHT + VERTICAL_SPACING)
      positions.set(nodeId, { x, y })
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
