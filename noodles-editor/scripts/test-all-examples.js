#!/usr/bin/env node

/**
 * Test All Examples
 *
 * Verifies that all example projects:
 * 1. Load without errors
 * 2. Have no AccessorOp nodes
 * 3. Have valid node graphs
 * 4. Use CreateAttributeOp correctly
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const EXAMPLES_DIR = path.join(__dirname, '../src/examples')

function validateProject(projectPath, exampleName) {
  const content = fs.readFileSync(projectPath, 'utf-8')
  const project = JSON.parse(content)

  const issues = []
  const warnings = []
  const stats = {
    nodes: project.nodes.length,
    edges: project.edges.length,
    accessorOps: 0,
    createAttributeOps: 0,
    layers: 0
  }

  // Check for AccessorOp nodes
  const accessorNodes = project.nodes.filter(n => n.type === 'AccessorOp')
  stats.accessorOps = accessorNodes.length

  if (accessorNodes.length > 0) {
    issues.push(`Found ${accessorNodes.length} AccessorOp node(s): ${accessorNodes.map(n => n.id).join(', ')}`)
  }

  // Count CreateAttributeOp nodes
  const createAttrNodes = project.nodes.filter(n => n.type === 'CreateAttributeOp')
  stats.createAttributeOps = createAttrNodes.length

  // Count layer nodes
  const layerNodes = project.nodes.filter(n => n.type.includes('Layer'))
  stats.layers = layerNodes.length

  // Check for orphaned nodes (no connections)
  for (const node of project.nodes) {
    const hasIncoming = project.edges.some(e => e.target === node.id)
    const hasOutgoing = project.edges.some(e => e.source === node.id)

    if (!hasIncoming && !hasOutgoing && node.type !== 'OutOp' && node.type !== 'FileOp' &&
        node.type !== 'MaplibreBasemapOp' && !node.id.includes('data-source')) {
      warnings.push(`Orphaned node: ${node.id} (${node.type})`)
    }
  }

  // Validate CreateAttributeOp configuration
  for (const node of createAttrNodes) {
    if (!node.data.inputs.name) {
      issues.push(`CreateAttributeOp ${node.id} missing 'name' field`)
    }
    if (!node.data.inputs.expression) {
      issues.push(`CreateAttributeOp ${node.id} missing 'expression' field`)
    }
    if (!node.data.inputs.size || node.data.inputs.size < 1 || node.data.inputs.size > 4) {
      warnings.push(`CreateAttributeOp ${node.id} has unusual size: ${node.data.inputs.size}`)
    }
  }

  // Check for broken edges
  for (const edge of project.edges) {
    const sourceExists = project.nodes.some(n => n.id === edge.source)
    const targetExists = project.nodes.some(n => n.id === edge.target)

    if (!sourceExists) {
      issues.push(`Edge ${edge.id} references non-existent source: ${edge.source}`)
    }
    if (!targetExists) {
      issues.push(`Edge ${edge.id} references non-existent target: ${edge.target}`)
    }
  }

  // Check layer data connections
  for (const layer of layerNodes) {
    const hasDataInput = project.edges.some(e =>
      e.target === layer.id && e.targetHandle === 'par.data'
    )
    if (!hasDataInput) {
      warnings.push(`Layer ${layer.id} has no data input connection`)
    }
  }

  return { issues, warnings, stats }
}

function main() {
  console.log('🧪 Testing All Examples')
  console.log('======================\n')

  const examples = fs.readdirSync(EXAMPLES_DIR)
    .filter(dir => {
      const fullPath = path.join(EXAMPLES_DIR, dir)
      return fs.statSync(fullPath).isDirectory()
    })

  let totalIssues = 0
  let totalWarnings = 0
  let totalAccessors = 0
  const failedExamples = []
  const results = []

  for (const example of examples) {
    const projectPath = path.join(EXAMPLES_DIR, example, 'noodles.json')

    if (!fs.existsSync(projectPath)) {
      console.log(`⏭️  ${example} - No noodles.json\n`)
      continue
    }

    console.log(`📦 ${example}`)

    try {
      const result = validateProject(projectPath, example)

      // Display stats
      console.log(`   Nodes: ${result.stats.nodes}, Edges: ${result.stats.edges}`)
      console.log(`   CreateAttributeOps: ${result.stats.createAttributeOps}, Layers: ${result.stats.layers}`)

      // Display issues
      if (result.issues.length > 0) {
        console.log(`   ❌ Issues (${result.issues.length}):`)
        for (const issue of result.issues) {
          console.log(`      - ${issue}`)
        }
        failedExamples.push(example)
      } else {
        console.log(`   ✅ No issues`)
      }

      // Display warnings
      if (result.warnings.length > 0) {
        console.log(`   ⚠️  Warnings (${result.warnings.length}):`)
        for (const warning of result.warnings) {
          console.log(`      - ${warning}`)
        }
      }

      totalIssues += result.issues.length
      totalWarnings += result.warnings.length
      totalAccessors += result.stats.accessorOps
      results.push({ example, ...result })

      console.log()
    } catch (error) {
      console.error(`   ❌ Error: ${error.message}\n`)
      failedExamples.push(example)
      totalIssues++
    }
  }

  // Summary
  console.log('\n======================')
  console.log('📊 Test Summary')
  console.log('======================')
  console.log(`Examples tested: ${examples.length}`)
  console.log(`Total issues: ${totalIssues}`)
  console.log(`Total warnings: ${totalWarnings}`)
  console.log(`AccessorOp nodes found: ${totalAccessors}`)

  if (failedExamples.length > 0) {
    console.log(`\n❌ Failed examples (${failedExamples.length}):`)
    for (const example of failedExamples) {
      console.log(`  - ${example}`)
    }
  } else {
    console.log('\n✅ All examples passed!')
  }

  // CreateAttributeOp coverage
  const examplesWithAttrs = results.filter(r => r.stats.createAttributeOps > 0).length
  console.log(`\nCreateAttributeOp coverage: ${examplesWithAttrs}/${examples.length} examples`)

  // Exit with error code if any issues
  process.exit(totalIssues > 0 ? 1 : 0)
}

main()
