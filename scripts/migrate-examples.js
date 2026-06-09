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

  // Calculate depth for each node (longest path from any root)
  const depths = new Map()
  const visited = new Set()

  function calculateDepth(nodeId) {
    if (depths.has(nodeId)) return depths.get(nodeId)
    if (visited.has(nodeId)) return 0
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

  // Identify special node types
  const layerNodes = nodes.filter(isLayerOp)
  const deckNode = nodes.find(n => n.type === 'DeckRendererOp')
  const basemapNode = nodes.find(isBasemap)
  const outNode = nodes.find(n => n.type === 'OutOp' || n.type === 'ViewerOp')

  // Find nodes that feed into layers (data pipeline)
  function feedsIntoLayers(nodeId, visited = new Set()) {
    if (visited.has(nodeId)) return false
    visited.add(nodeId)

    const node = nodeMap.get(nodeId)
    if (isLayerOp(node)) return true

    const targets = outgoing.get(nodeId) || []
    return targets.some(t => feedsIntoLayers(t, visited))
  }

  const dataPipelineNodes = nodes.filter(n => {
    if (isLayerOp(n) || isRenderer(n) || isBasemap(n)) return false
    return feedsIntoLayers(n.id)
  })

  // Separate data pipeline into primary (feeds data) vs utility (feeds parameters/colors)
  const primaryDataNodes = dataPipelineNodes.filter(n => {
    const targets = outgoing.get(n.id) || []
    // Check if any target receives data on par.data
    return edges.some(e => e.source === n.id && e.targetHandle === 'par.data')
  })

  const utilityNodes = dataPipelineNodes.filter(n => !primaryDataNodes.includes(n))

  // Calculate column positions
  // Primary data flows left to right by depth
  const maxDataDepth = Math.max(...primaryDataNodes.map(n => depths.get(n.id)), -1)

  const layerCol = maxDataDepth + 2
  const utilityCol = layerCol - 1
  const deckCol = layerCol + 1
  const outCol = deckCol + 1

  // Assign Y positions for layers first (they anchor everything)
  layerNodes.sort((a, b) => depths.get(a.id) - depths.get(b.id))
  const layerYs = layerNodes.map((n, i) => LAYOUT.CHAIN_START_Y + i * LAYOUT.VERTICAL_SPACING * 3)
  const layerMinY = Math.min(...layerYs)
  const layerMaxY = Math.max(...layerYs)
  const layerMidY = (layerMinY + layerMaxY) / 2

  // Position layers
  layerNodes.forEach((n, i) => {
    n.position = {
      x: LAYOUT.CHAIN_START_X + layerCol * LAYOUT.HORIZONTAL_SPACING,
      y: layerYs[i]
    }
  })

  // Position primary data nodes by depth, centered vertically
  const dataByCol = new Map()
  primaryDataNodes.forEach(n => {
    const col = depths.get(n.id)
    if (!dataByCol.has(col)) dataByCol.set(col, [])
    dataByCol.get(col).push(n)
  })

  for (let col = 0; col <= maxDataDepth; col++) {
    if (!dataByCol.has(col)) continue
    const colNodes = dataByCol.get(col)
    const colStartY = layerMidY - ((colNodes.length - 1) * LAYOUT.VERTICAL_SPACING) / 2
    colNodes.forEach((n, i) => {
      n.position = {
        x: LAYOUT.CHAIN_START_X + col * LAYOUT.HORIZONTAL_SPACING,
        y: colStartY + i * LAYOUT.VERTICAL_SPACING
      }
    })
  }

  // Position utility nodes (colors, blending) - place BELOW layers, near them
  if (utilityNodes.length > 0) {
    const utilStartY = layerMaxY + LAYOUT.VERTICAL_SPACING * 2
    utilityNodes.forEach((n, i) => {
      n.position = {
        x: LAYOUT.CHAIN_START_X + utilityCol * LAYOUT.HORIZONTAL_SPACING,
        y: utilStartY + i * LAYOUT.VERTICAL_SPACING
      }
    })
  }

  // Position Deck at layer midpoint
  if (deckNode) {
    deckNode.position = {
      x: LAYOUT.CHAIN_START_X + deckCol * LAYOUT.HORIZONTAL_SPACING,
      y: layerMidY
    }
  }

  // Position basemap: dock below Deck if no dependencies, otherwise with layers at bottom
  if (basemapNode) {
    const basemapDeps = incoming.get(basemapNode.id) || []
    if (basemapDeps.length > 0) {
      // Has dependencies - put in layer column at bottom
      basemapNode.position = {
        x: LAYOUT.CHAIN_START_X + layerCol * LAYOUT.HORIZONTAL_SPACING,
        y: layerMaxY + LAYOUT.VERTICAL_SPACING
      }
    } else {
      // No dependencies - dock below Deck
      basemapNode.position = {
        x: LAYOUT.CHAIN_START_X + deckCol * LAYOUT.HORIZONTAL_SPACING,
        y: layerMidY + LAYOUT.VERTICAL_SPACING * 2
      }
    }
  }

  // Position Out
  if (outNode) {
    outNode.position = {
      x: LAYOUT.CHAIN_START_X + outCol * LAYOUT.HORIZONTAL_SPACING,
      y: layerMidY
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
