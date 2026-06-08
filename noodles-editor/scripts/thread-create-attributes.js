#!/usr/bin/env node

/**
 * Thread CreateAttributeOps into Data Flow
 *
 * Ensures CreateAttributeOp nodes are properly threaded from data sources to layers.
 *
 * Pattern to create:
 *   /data-source -> /create-attr -> /layer
 *
 * Instead of:
 *   /data-source -> /layer (removed)
 *   /create-attr -> /layer (orphaned, no input!)
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const EXAMPLES_DIR = path.join(__dirname, '../src/examples')
const DRY_RUN = process.argv.includes('--dry-run')

function fixProject(projectPath) {
  const content = fs.readFileSync(projectPath, 'utf-8')
  const project = JSON.parse(content)

  // Find all CreateAttributeOp nodes
  const createAttrNodes = project.nodes.filter(n => n.type === 'CreateAttributeOp')

  if (createAttrNodes.length === 0) {
    return { fixed: false, reason: 'No CreateAttributeOps' }
  }

  // Find CreateAttributeOps that have outputs but no data inputs
  const orphanedCreateAttrs = []

  for (const node of createAttrNodes) {
    const hasDataInput = project.edges.some(
      e => e.target === node.id && e.targetHandle === 'par.data'
    )
    const hasDataOutput = project.edges.some(
      e => e.source === node.id && e.sourceHandle === 'out.data'
    )

    if (!hasDataInput && hasDataOutput) {
      orphanedCreateAttrs.push(node)
    }
  }

  if (orphanedCreateAttrs.length === 0) {
    return { fixed: false, reason: 'No orphaned CreateAttributeOps' }
  }

  const newEdges = [...project.edges]
  let fixedCount = 0

  for (const createAttr of orphanedCreateAttrs) {
    // Find what this CreateAttributeOp outputs to
    const outputEdges = project.edges.filter(
      e => e.source === createAttr.id && e.sourceHandle === 'out.data'
    )

    if (outputEdges.length === 0) continue

    // Find what was originally feeding those targets (likely a FileOp or DuckDbOp)
    // by looking at nodes that don't have CreateAttributeOp connections
    const targets = outputEdges.map(e => e.target)

    // Look for FileOp, DuckDbOp, or CodeOp nodes that could be the data source
    const potentialSources = project.nodes.filter(n =>
      ['FileOp', 'DuckDbOp', 'CodeOp'].includes(n.type)
    )

    if (potentialSources.length === 0) continue

    // Use the first potential source (usually there's only one FileOp or DuckDbOp)
    const source = potentialSources[0]

    // Create edge from source to CreateAttributeOp
    const newEdge = {
      id: `${source.id}.out.data->${createAttr.id}.par.data`,
      source: source.id,
      sourceHandle: 'out.data',
      target: createAttr.id,
      targetHandle: 'par.data'
    }

    newEdges.push(newEdge)
    console.log(`  Adding: ${source.id} -> ${createAttr.id}`)
    fixedCount++
  }

  if (fixedCount === 0) {
    return { fixed: false, reason: 'No edges to add' }
  }

  const updatedProject = {
    ...project,
    edges: newEdges
  }

  if (!DRY_RUN) {
    fs.writeFileSync(projectPath, JSON.stringify(updatedProject, null, 2))
  }

  return { fixed: true, count: fixedCount }
}

function main() {
  console.log('🔗 Threading CreateAttributeOps into Data Flow')
  console.log('===============================================\n')

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
      const result = fixProject(projectPath)

      if (result.fixed) {
        console.log(`   ✅ Connected ${result.count} CreateAttributeOp(s)\n`)
        fixed++
      } else {
        console.log(`   ⏭️  ${result.reason}\n`)
      }
    } catch (error) {
      console.error(`   ❌ Error: ${error.message}\n`)
    }
  }

  console.log('===============================================')
  console.log(`✨ Fixed ${fixed}/${examples.length} examples`)

  if (DRY_RUN) {
    console.log('\n⚠️  DRY RUN - Run without --dry-run to apply')
  }
}

main()
