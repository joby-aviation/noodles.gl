#!/usr/bin/env node

/**
 * Fix Duplicate Data Connections
 *
 * Removes duplicate par.data connections where both a data source AND
 * a CreateAttributeOp connect to the same layer.
 *
 * Pattern to fix:
 *   /data-source -> /layer.par.data (REMOVE)
 *   /create-attr -> /layer.par.data (KEEP)
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
  const createAttrNodes = new Set(
    project.nodes.filter(n => n.type === 'CreateAttributeOp').map(n => n.id)
  )

  if (createAttrNodes.size === 0) {
    return { fixed: false, reason: 'No CreateAttributeOps' }
  }

  // Group par.data edges by target
  const dataEdgesByTarget = new Map()
  for (const edge of project.edges) {
    if (edge.targetHandle === 'par.data') {
      if (!dataEdgesByTarget.has(edge.target)) {
        dataEdgesByTarget.set(edge.target, [])
      }
      dataEdgesByTarget.get(edge.target).push(edge)
    }
  }

  // Find targets with duplicate data connections
  const edgesToRemove = new Set()
  let fixedCount = 0

  for (const [target, edges] of dataEdgesByTarget) {
    if (edges.length <= 1) continue

    // Check if any edge comes from CreateAttributeOp
    const createAttrEdges = edges.filter(e => createAttrNodes.has(e.source))
    const otherEdges = edges.filter(e => !createAttrNodes.has(e.source))

    if (createAttrEdges.length > 0 && otherEdges.length > 0) {
      // Remove non-CreateAttributeOp connections
      for (const edge of otherEdges) {
        edgesToRemove.add(edge.id)
        console.log(`  Removing: ${edge.source} -> ${edge.target}`)
        fixedCount++
      }
    }
  }

  if (edgesToRemove.size === 0) {
    return { fixed: false, reason: 'No duplicates found' }
  }

  // Filter out edges to remove
  const updatedProject = {
    ...project,
    edges: project.edges.filter(e => !edgesToRemove.has(e.id))
  }

  if (!DRY_RUN) {
    fs.writeFileSync(projectPath, JSON.stringify(updatedProject, null, 2))
  }

  return { fixed: true, count: fixedCount }
}

function main() {
  console.log('🔧 Fixing Duplicate Data Connections')
  console.log('====================================\n')

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
        console.log(`   ✅ Fixed ${result.count} duplicate connection(s)\n`)
        fixed++
      } else {
        console.log(`   ⏭️  ${result.reason}\n`)
      }
    } catch (error) {
      console.error(`   ❌ Error: ${error.message}\n`)
    }
  }

  console.log('====================================')
  console.log(`✨ Fixed ${fixed}/${examples.length} examples`)

  if (DRY_RUN) {
    console.log('\n⚠️  DRY RUN - Run without --dry-run to apply')
  }
}

main()
