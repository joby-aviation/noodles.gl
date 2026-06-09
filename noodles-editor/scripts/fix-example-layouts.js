#!/usr/bin/env node

/**
 * Fix Example Layouts - Simple left-to-right layout matching nyc-taxis style
 *
 * Layout style:
 * - 400px horizontal spacing between columns
 * - 200px vertical spacing between nodes
 * - Simple topological sort (longest path from sources)
 * - No forced vertical centering or alignment
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
  CodeOp: { width: 400, height: 300 },
  TableEditorOp: { width: 300, height: 250 },
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
  TripsLayerOp: { width: 250, height: 280 },
  DeckRendererOp: { width: 220, height: 120 },
  MaplibreBasemapOp: { width: 220, height: 200 },
  OutOp: { width: 150, height: 80 },
  default: { width: 200, height: 150 }
}

function getNodeSize(nodeType) {
  return NODE_SIZES[nodeType] || NODE_SIZES.default
}

/**
 * Simple topological sort: assign each node to a column based on longest path from sources
 */
function computeLayers(nodes, edges) {
  const graph = new Map()
  const inDegree = new Map()
  const layer = new Map()

  // Initialize
  for (const node of nodes) {
    graph.set(node.id, [])
    inDegree.set(node.id, 0)
    layer.set(node.id, 0)
  }

  // Build adjacency list and count in-degrees
  for (const edge of edges) {
    if (graph.has(edge.source) && graph.has(edge.target)) {
      graph.get(edge.source).push(edge.target)
      inDegree.set(edge.target, inDegree.get(edge.target) + 1)
    }
  }

  // Find source nodes (no incoming edges)
  const sources = []
  for (const node of nodes) {
    if (inDegree.get(node.id) === 0) {
      sources.push(node.id)
      layer.set(node.id, 0)
    }
  }

  // Topological sort with longest path
  const queue = [...sources]
  const processed = new Set()

  while (queue.length > 0) {
    const nodeId = queue.shift()
    if (processed.has(nodeId)) continue
    processed.add(nodeId)

    const currentLayer = layer.get(nodeId)
    const children = graph.get(nodeId) || []

    for (const child of children) {
      // Child must be at least one layer to the right
      const newLayer = Math.max(layer.get(child), currentLayer + 1)
      layer.set(child, newLayer)

      // Add to queue when all parents processed
      const parentsProcessed = edges
        .filter(e => e.target === child)
        .every(e => processed.has(e.source))

      if (parentsProcessed && !processed.has(child)) {
        queue.push(child)
      }
    }
  }

  return layer
}

/**
 * Apply simple layout: stack nodes in columns with consistent spacing
 */
function applySimpleLayout(nodes, edges) {
  const layer = computeLayers(nodes, edges)

  // Group nodes by layer
  const maxLayer = Math.max(...Array.from(layer.values()))
  const layers = []

  for (let i = 0; i <= maxLayer; i++) {
    layers.push([])
  }

  for (const node of nodes) {
    const l = layer.get(node.id)
    layers[l].push(node)
  }

  const HORIZONTAL_SPACING = 400  // Match nyc-taxis style
  const VERTICAL_SPACING = 200
  const START_X = 100
  const START_Y = 100

  // Assign positions: simple stacking
  const updatedNodes = []
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
    const layerNodes = layers[layerIndex]
    const x = START_X + layerIndex * HORIZONTAL_SPACING

    let y = START_Y
    for (const node of layerNodes) {
      updatedNodes.push({
        ...node,
        position: { x, y }
      })

      const size = getNodeSize(node.type)
      y += size.height + VERTICAL_SPACING
    }
  }

  return updatedNodes
}

function fixProjectLayout(projectPath) {
  const content = fs.readFileSync(projectPath, 'utf-8')
  const project = JSON.parse(content)

  const layoutedNodes = applySimpleLayout(project.nodes, project.edges)

  const updatedProject = {
    ...project,
    nodes: layoutedNodes,
    viewport: { x: 0, y: 0, zoom: 0.8 }
  }

  if (!DRY_RUN) {
    fs.writeFileSync(projectPath, JSON.stringify(updatedProject, null, 2))
  }

  return { success: true }
}

function main() {
  console.log('🎨 Fixing Example Layouts')
  console.log('=========================\n')

  if (DRY_RUN) {
    console.log('⚠️  DRY RUN MODE\n')
  }

  const examples = fs.readdirSync(EXAMPLES_DIR)
    .filter(dir => fs.statSync(path.join(EXAMPLES_DIR, dir)).isDirectory())

  let fixed = 0

  for (const example of examples) {
    const projectPath = path.join(EXAMPLES_DIR, example, 'noodles.json')

    if (!fs.existsSync(projectPath)) {
      continue
    }

    try {
      console.log(`📦 ${example}`)
      fixProjectLayout(projectPath)
      console.log(`   ✅ Layout fixed\n`)
      fixed++
    } catch (error) {
      console.error(`   ❌ Error: ${error.message}\n`)
    }
  }

  console.log('=========================')
  console.log(`✨ Fixed ${fixed}/${examples.length} examples`)

  if (DRY_RUN) {
    console.log('\n⚠️  DRY RUN - Run without --dry-run to apply')
  }
}

main()
