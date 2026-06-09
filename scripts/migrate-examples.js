#!/usr/bin/env node

// Unified example project migration and layout tool
//
// Applies migrations to all example projects and ensures proper node layout.
// Run with: node scripts/migrate-examples.js [--dry-run] [--layout-only]

const fs = require('fs')
const path = require('path')

const EXAMPLES_DIR = path.join(__dirname, '../noodles-editor/src/examples')
const TARGET_VERSION = 15

const args = process.argv.slice(2)
const isDryRun = args.includes('--dry-run')
const layoutOnly = args.includes('--layout-only')

// Node layout configuration
const LAYOUT = {
  HORIZONTAL_SPACING: 400,
  VERTICAL_SPACING: 120,
  CHAIN_START_X: 200,
  CHAIN_START_Y: 100,
}

// Check if node is a layer operator
function isLayerOp(node) {
  return node.type && node.type.includes('Layer')
}

// Check if node is a renderer (Deck, Out, etc.)
function isRenderer(node) {
  return node.type === 'DeckRendererOp' || node.type === 'OutOp' || node.type === 'ViewerOp'
}

// Check if node is a basemap
function isBasemap(node) {
  return node.type === 'MaplibreBasemapOp' || node.type === 'MapboxOp' || node.type === 'MapStyleOp'
}

// Layout nodes in a readable flow
function layoutNodes(project) {
  const { nodes, edges } = project
  const nodeMap = new Map(nodes.map(n => [n.id, n]))

  // Build adjacency maps
  const outgoing = new Map()
  const incoming = new Map()

  for (const edge of edges) {
    if (!edge.source || !edge.target) continue

    const out = outgoing.get(edge.source) || []
    out.push(edge.target)
    outgoing.set(edge.source, out)

    const inc = incoming.get(edge.target) || []
    inc.push(edge.source)
    incoming.set(edge.target, inc)
  }

  // Calculate depth for each node (longest path from root)
  const depths = new Map()
  const visited = new Set()

  function calculateDepth(nodeId) {
    if (depths.has(nodeId)) return depths.get(nodeId)
    if (visited.has(nodeId)) return 0 // Cycle detection
    visited.add(nodeId)

    const parents = incoming.get(nodeId) || []
    let maxDepth = 0
    for (const parent of parents) {
      maxDepth = Math.max(maxDepth, calculateDepth(parent) + 1)
    }
    depths.set(nodeId, maxDepth)
    visited.delete(nodeId)
    return maxDepth
  }

  nodes.forEach(n => calculateDepth(n.id))

  // Group nodes by type and depth
  const layers = []
  const layerNodes = nodes.filter(isLayerOp)
  const deckNode = nodes.find(n => n.type === 'DeckRendererOp')
  const basemapNode = nodes.find(isBasemap)
  const outNode = nodes.find(n => n.type === 'OutOp' || n.type === 'ViewerOp')

  // Find data pipeline nodes (FileOp, CreateAttributeOp, DuckDbOp, etc.)
  const dataPipelineNodes = nodes.filter(n => {
    if (isLayerOp(n) || isRenderer(n) || isBasemap(n)) return false
    // Check if this feeds into layers
    const descendants = outgoing.get(n.id) || []
    return descendants.some(d => isLayerOp(nodeMap.get(d)))
  })

  // Find shared utility nodes (ColorOp, BlendingOp, etc. that feed into layers)
  const utilityNodes = nodes.filter(n => {
    if (isLayerOp(n) || isRenderer(n) || isBasemap(n) || dataPipelineNodes.includes(n)) return false
    // Check if this node or its descendants feed into layers
    const targets = outgoing.get(n.id) || []
    return targets.some(t => isLayerOp(nodeMap.get(t)))
  })

  // Assign to columns
  // Column layout: Data pipeline → Utility → Layers → Deck → Out

  const positions = new Map()

  // Position data pipeline nodes by depth
  const maxDataDepth = Math.max(...dataPipelineNodes.map(n => depths.get(n.id)), -1)
  dataPipelineNodes.forEach(n => {
    const depth = depths.get(n.id)
    const col = depth
    if (!positions.has(col)) positions.set(col, [])
    positions.get(col).push(n)
  })

  // Layer column comes after data pipeline
  const layerCol = maxDataDepth + 2

  // Utility nodes go in column right before layers
  const utilityCol = layerCol - 1
  utilityNodes.forEach(n => {
    if (!positions.has(utilityCol)) positions.set(utilityCol, [])
    positions.get(utilityCol).push(n)
  })

  // Position layer nodes
  layerNodes.forEach(n => {
    if (!positions.has(layerCol)) positions.set(layerCol, [])
    positions.get(layerCol).push(n)
  })

  // Position Deck renderer in next column
  const deckCol = layerCol + 1
  if (deckNode) {
    if (!positions.has(deckCol)) positions.set(deckCol, [])
    positions.get(deckCol).push(deckNode)
  }

  // Position Out in next column
  const outCol = deckCol + 1
  if (outNode) {
    if (!positions.has(outCol)) positions.set(outCol, [])
    positions.get(outCol).push(outNode)
  }

  // Calculate Y positions - center Deck vertically with layers
  const layerYPositions = []
  if (positions.has(layerCol)) {
    const layerCount = positions.get(layerCol).length
    const layerStartY = LAYOUT.CHAIN_START_Y
    positions.get(layerCol).forEach((n, i) => {
      const y = layerStartY + i * LAYOUT.VERTICAL_SPACING
      layerYPositions.push(y)
      n.position = {
        x: LAYOUT.CHAIN_START_X + layerCol * LAYOUT.HORIZONTAL_SPACING,
        y
      }
    })
  }

  // Calculate vertical midpoint of layers
  const layerMidY = layerYPositions.length > 0
    ? (layerYPositions[0] + layerYPositions[layerYPositions.length - 1]) / 2
    : LAYOUT.CHAIN_START_Y

  // Position Deck at layer midpoint
  if (deckNode) {
    deckNode.position = {
      x: LAYOUT.CHAIN_START_X + deckCol * LAYOUT.HORIZONTAL_SPACING,
      y: layerMidY
    }
  }

  // Position Out slightly offset from Deck
  if (outNode) {
    outNode.position = {
      x: LAYOUT.CHAIN_START_X + outCol * LAYOUT.HORIZONTAL_SPACING,
      y: layerMidY
    }
  }

  // Position data pipeline nodes (centered with layers)
  for (let col = 0; col <= maxDataDepth; col++) {
    if (!positions.has(col)) continue
    const colNodes = positions.get(col)
    const colStartY = layerMidY - ((colNodes.length - 1) * LAYOUT.VERTICAL_SPACING) / 2
    colNodes.forEach((n, i) => {
      n.position = {
        x: LAYOUT.CHAIN_START_X + col * LAYOUT.HORIZONTAL_SPACING,
        y: colStartY + i * LAYOUT.VERTICAL_SPACING
      }
    })
  }

  // Position utility nodes (centered with layers)
  if (positions.has(utilityCol)) {
    const utilNodes = positions.get(utilityCol)
    const utilStartY = layerMidY - ((utilNodes.length - 1) * LAYOUT.VERTICAL_SPACING) / 2
    utilNodes.forEach((n, i) => {
      n.position = {
        x: LAYOUT.CHAIN_START_X + utilityCol * LAYOUT.HORIZONTAL_SPACING,
        y: utilStartY + i * LAYOUT.VERTICAL_SPACING
      }
    })
  }

  // Position basemap: if it has dependencies, put it with layers at bottom; otherwise dock below Deck
  if (basemapNode) {
    const basemapDeps = incoming.get(basemapNode.id) || []
    if (basemapDeps.length > 0) {
      // Has upstream dependencies - put in layer column at bottom
      const bottomY = layerYPositions.length > 0
        ? layerYPositions[layerYPositions.length - 1] + LAYOUT.VERTICAL_SPACING
        : LAYOUT.CHAIN_START_Y
      basemapNode.position = {
        x: LAYOUT.CHAIN_START_X + layerCol * LAYOUT.HORIZONTAL_SPACING,
        y: bottomY
      }
    } else {
      // No dependencies - dock below Deck
      basemapNode.position = {
        x: LAYOUT.CHAIN_START_X + deckCol * LAYOUT.HORIZONTAL_SPACING,
        y: layerMidY + LAYOUT.VERTICAL_SPACING * 1.5
      }
    }
  }

  return project
}

// Migrate a single project
async function migrateProject(projectPath, projectName) {
  console.log(`\n📁 ${projectName}`)

  const content = fs.readFileSync(projectPath, 'utf8')
  let project

  try {
    project = JSON.parse(content)
  } catch (e) {
    console.error(`  ❌ Invalid JSON: ${e.message}`)
    return false
  }

  const startVersion = project.version || 0

  if (layoutOnly) {
    console.log('  🎨 Re-layouting nodes...')
    project = layoutNodes(project)
  } else {
    // For now, just ensure version is up to date
    // Migration logic would go here if needed
    if (project.version < TARGET_VERSION) {
      console.log(`  ⬆️  Updating version ${startVersion} → ${TARGET_VERSION}`)
      project.version = TARGET_VERSION
    }

    // Layout after migration
    console.log('  🎨 Re-layouting nodes...')
    project = layoutNodes(project)
  }

  if (isDryRun) {
    console.log('  ✅ Would update (dry run)')
    return true
  }

  // Write back
  fs.writeFileSync(projectPath, JSON.stringify(project, null, 2) + '\n')
  console.log(`  ✅ Updated`)

  return true
}

// Main
async function main() {
  console.log('🔧 Unified Example Migration Tool')
  console.log(`   Target version: ${TARGET_VERSION}`)
  if (isDryRun) console.log('   Mode: DRY RUN')
  if (layoutOnly) console.log('   Mode: LAYOUT ONLY')
  console.log()

  const examples = fs.readdirSync(EXAMPLES_DIR)
  let successCount = 0
  let errorCount = 0

  for (const example of examples) {
    const noodlesPath = path.join(EXAMPLES_DIR, example, 'noodles.json')

    if (!fs.existsSync(noodlesPath)) {
      continue
    }

    const success = await migrateProject(noodlesPath, example)
    if (success) {
      successCount++
    } else {
      errorCount++
    }
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log(`📊 Summary: ${successCount} migrated, ${errorCount} errors`)

  if (errorCount > 0) {
    process.exit(1)
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
