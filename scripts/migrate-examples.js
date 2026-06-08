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

// Layout nodes in a readable flow
function layoutNodes(project) {
  const { nodes, edges } = project

  // Build adjacency map
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

  // Find root nodes (no incoming edges)
  const roots = nodes.filter(n => !incoming.has(n.id))

  // Topological sort to determine layers
  const visited = new Set()
  const layers = []

  function visit(nodeId, layer = 0) {
    if (visited.has(nodeId)) return
    visited.add(nodeId)

    if (!layers[layer]) layers[layer] = []
    layers[layer].push(nodeId)

    const children = outgoing.get(nodeId) || []
    for (const child of children) {
      visit(child, layer + 1)
    }
  }

  for (const root of roots) {
    visit(root.id)
  }

  // Position nodes by layer
  const nodeMap = new Map(nodes.map(n => [n.id, n]))

  for (let layerIdx = 0; layerIdx < layers.length; layerIdx++) {
    const layerNodes = layers[layerIdx]
    const x = LAYOUT.CHAIN_START_X + layerIdx * LAYOUT.HORIZONTAL_SPACING

    for (let i = 0; i < layerNodes.length; i++) {
      const node = nodeMap.get(layerNodes[i])
      if (node) {
        node.position = {
          x,
          y: LAYOUT.CHAIN_START_Y + i * LAYOUT.VERTICAL_SPACING,
        }
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
