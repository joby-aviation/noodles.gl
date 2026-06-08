#!/usr/bin/env node

/**
 * Fix Example Layouts - Apply proper left-to-right layout
 *
 * Ensures:
 * - OutOp on the far right
 * - Each dependency level aligned horizontally
 * - FileOps on the far left
 * - Single-connection chains maintain vertical alignment
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
  TripsLayerOp: { width: 250, height: 280 },
  DeckRendererOp: { width: 220, height: 120 },
  MaplibreBasemapOp: { width: 220, height: 200 },
  OutOp: { width: 150, height: 80 },
  default: { width: 200, height: 150 }
}

function getNodeSize(nodeType) {
  return NODE_SIZES[nodeType] || NODE_SIZES.default
}

function buildDependencyGraph(nodes, edges) {
  const graph = new Map()
  const reverseGraph = new Map()

  for (const node of nodes) {
    graph.set(node.id, [])
    reverseGraph.set(node.id, [])
  }

  for (const edge of edges) {
    if (graph.has(edge.source) && graph.has(edge.target)) {
      graph.get(edge.source).push(edge.target)
      reverseGraph.get(edge.target).push(edge.source)
    }
  }

  return { graph, reverseGraph }
}

function applySmartLayout(nodes, edges) {
  const { graph, reverseGraph } = buildDependencyGraph(nodes, edges)

  // Calculate longest path from each node to sinks (OutOp, etc.)
  const longestPath = new Map()

  // Find sink nodes (nodes with no outgoing edges)
  const sinks = []
  for (const node of nodes) {
    const hasOutgoing = graph.get(node.id).length > 0
    if (!hasOutgoing) {
      sinks.push(node.id)
      longestPath.set(node.id, 0)
    }
  }

  // BFS from sinks backwards to calculate longest path
  const queue = [...sinks]
  const visited = new Set()

  while (queue.length > 0) {
    const nodeId = queue.shift()
    if (visited.has(nodeId)) continue
    visited.add(nodeId)

    const currentPath = longestPath.get(nodeId) || 0
    const parents = reverseGraph.get(nodeId) || []

    for (const parent of parents) {
      const newPath = currentPath + 1
      const existingPath = longestPath.get(parent) || 0
      if (newPath > existingPath) {
        longestPath.set(parent, newPath)
      }
      queue.push(parent)
    }
  }

  // Group nodes by layer (distance from sinks)
  const maxLayer = Math.max(...Array.from(longestPath.values()), 0)
  const layers = Array.from({ length: maxLayer + 1 }, () => [])

  for (const node of nodes) {
    const path = longestPath.get(node.id) || 0
    const layer = maxLayer - path
    layers[layer].push(node)
  }

  // Layout parameters
  const HORIZONTAL_SPACING = 400
  const VERTICAL_SPACING = 200
  const START_X = 100
  const START_Y = 100

  const nodePositions = new Map()

  // Process each layer
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
    const layerNodes = layers[layerIndex]
    const x = START_X + layerIndex * HORIZONTAL_SPACING

    // Group nodes by their immediate downstream target
    const nodesByTarget = new Map()

    for (const node of layerNodes) {
      const targets = graph.get(node.id) || []

      if (targets.length === 1) {
        const target = targets[0]
        if (!nodesByTarget.has(target)) {
          nodesByTarget.set(target, [])
        }
        nodesByTarget.get(target).push(node)
      } else {
        // Multiple or no targets
        const key = `_branch_${node.id}`
        nodesByTarget.set(key, [node])
      }
    }

    // Assign Y positions
    let currentY = START_Y

    for (const [targetId, nodeGroup] of nodesByTarget) {
      if (nodeGroup.length === 1 && !targetId.startsWith('_branch_')) {
        // Single node feeding into one target - try to align
        const targetPos = nodePositions.get(targetId)

        if (targetPos) {
          // Align with target's Y position
          nodePositions.set(nodeGroup[0].id, { x, y: targetPos.y })
          const size = getNodeSize(nodeGroup[0].type)
          currentY = Math.max(currentY, targetPos.y + size.height + VERTICAL_SPACING)
        } else {
          // Target not positioned yet, use currentY
          nodePositions.set(nodeGroup[0].id, { x, y: currentY })
          const size = getNodeSize(nodeGroup[0].type)
          currentY += size.height + VERTICAL_SPACING
        }
      } else {
        // Multiple nodes or branching - stack vertically
        for (const node of nodeGroup) {
          nodePositions.set(node.id, { x, y: currentY })
          const size = getNodeSize(node.type)
          currentY += size.height + VERTICAL_SPACING
        }
      }
    }
  }

  // Apply positions
  return nodes.map(node => {
    const pos = nodePositions.get(node.id)
    return pos ? { ...node, position: { x: pos.x, y: pos.y } } : node
  })
}

function fixProjectLayout(projectPath) {
  const content = fs.readFileSync(projectPath, 'utf-8')
  const project = JSON.parse(content)

  const layoutedNodes = applySmartLayout(project.nodes, project.edges)

  const updatedProject = {
    ...project,
    nodes: layoutedNodes,
    viewport: { x: 0, y: 0, zoom: 0.8 } // Reset viewport
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
