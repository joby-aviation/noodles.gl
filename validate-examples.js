#!/usr/bin/env node
/**
 * Example Validation Tool
 *
 * Validates all example projects by checking:
 * 1. JSON schema validity
 * 2. All nodes reference valid operator types
 * 3. All edges reference existing nodes and valid handles
 * 4. Attribute flow: CreateAttributeOp outputs connect to layer inputs
 * 5. Version field present
 *
 * Usage: node validate-examples.js
 */

const fs = require('fs')
const path = require('path')

// Load operator registry dynamically
const examplesDir = path.join(__dirname, 'noodles-editor/src/examples')

// Known operator types (populated from operators.ts)
const VALID_OPERATORS = new Set()

// Auto-detect operators from operators.ts
const operatorsFile = path.join(__dirname, 'noodles-editor/src/noodles/operators.ts')
try {
  const content = fs.readFileSync(operatorsFile, 'utf8')
  const lines = content.split('\n')
  for (const line of lines) {
    const match = line.match(/^export class (\w+Op) extends Operator/)
    if (match) {
      VALID_OPERATORS.add(match[1])
    }
  }
  if (VALID_OPERATORS.size > 0) {
    console.log(`📦 Loaded ${VALID_OPERATORS.size} operator types from operators.ts\n`)
  } else {
    console.warn('⚠️  No operators found in operators.ts\n')
  }
} catch (e) {
  console.warn(`⚠️  Could not auto-detect operators: ${e.message}\n`)
}

const errors = []
const warnings = []

function validateProject(projectPath, projectName) {
  const projectErrors = []
  const projectWarnings = []

  try {
    const content = fs.readFileSync(projectPath, 'utf8')
    let project

    try {
      project = JSON.parse(content)
    } catch (e) {
      projectErrors.push(`Invalid JSON: ${e.message}`)
      return { errors: projectErrors, warnings: projectWarnings }
    }

    // Check version field
    if (project.version == null) {
      projectWarnings.push('Missing version field (will trigger unnecessary migrations)')
    }

    // Validate nodes
    const nodeIds = new Set()
    const createAttrOps = []

    if (!project.nodes || !Array.isArray(project.nodes)) {
      projectErrors.push('Missing or invalid nodes array')
      return { errors: projectErrors, warnings: projectWarnings }
    }

    for (const node of project.nodes) {
      if (!node.id) {
        projectErrors.push('Node missing id')
        continue
      }

      nodeIds.add(node.id)

      if (!node.type) {
        projectErrors.push(`Node ${node.id} missing type`)
      } else if (!VALID_OPERATORS.has(node.type)) {
        projectErrors.push(`Node ${node.id} has unknown type: ${node.type}`)
      }

      if (node.type === 'CreateAttributeOp') {
        createAttrOps.push(node)
      }

      // Check for data field structure
      if (!node.data || typeof node.data !== 'object') {
        projectWarnings.push(`Node ${node.id} missing data object`)
      }
    }

    // Validate edges
    if (!project.edges || !Array.isArray(project.edges)) {
      projectErrors.push('Missing or invalid edges array')
      return { errors: projectErrors, warnings: projectWarnings }
    }

    for (const edge of project.edges) {
      if (!edge.id) {
        projectWarnings.push('Edge missing id')
      }

      if (!edge.source) {
        projectErrors.push(`Edge ${edge.id || 'unknown'} missing source`)
      } else if (!nodeIds.has(edge.source)) {
        projectErrors.push(`Edge ${edge.id} references non-existent source: ${edge.source}`)
      }

      if (!edge.target) {
        projectErrors.push(`Edge ${edge.id || 'unknown'} missing target`)
      } else if (!nodeIds.has(edge.target)) {
        projectErrors.push(`Edge ${edge.id} references non-existent target: ${edge.target}`)
      }

      if (!edge.sourceHandle) {
        projectWarnings.push(`Edge ${edge.id} missing sourceHandle`)
      }

      if (!edge.targetHandle) {
        projectWarnings.push(`Edge ${edge.id} missing targetHandle`)
      }

      // Check for double-prefixed handles (common error)
      if (edge.sourceHandle && edge.sourceHandle.match(/^out\.out\./)) {
        projectErrors.push(`Edge ${edge.id} has double-prefixed sourceHandle: ${edge.sourceHandle}`)
      }

      if (edge.targetHandle && edge.targetHandle.match(/^par\.par\./)) {
        projectErrors.push(`Edge ${edge.id} has double-prefixed targetHandle: ${edge.targetHandle}`)
      }
    }

    // Check attribute flow: CreateAttributeOps should have input connections
    for (const node of createAttrOps) {
      const hasInputConnection = project.edges.some(e => e.target === node.id && e.targetHandle === 'par.data')
      if (!hasInputConnection) {
        projectWarnings.push(`CreateAttributeOp ${node.id} has no data input connection (orphaned)`)
      }

      const hasOutputConnection = project.edges.some(e => e.source === node.id)
      if (!hasOutputConnection) {
        projectWarnings.push(`CreateAttributeOp ${node.id} has no output connections (unused)`)
      }
    }

  } catch (e) {
    projectErrors.push(`Failed to validate: ${e.message}`)
  }

  return { errors: projectErrors, warnings: projectWarnings }
}

// Main
console.log('🔍 Validating example projects...\n')

const examples = fs.readdirSync(examplesDir)
let totalErrors = 0
let totalWarnings = 0

for (const example of examples) {
  const noodlesPath = path.join(examplesDir, example, 'noodles.json')

  if (!fs.existsSync(noodlesPath)) {
    continue
  }

  const { errors: projectErrors, warnings: projectWarnings } = validateProject(noodlesPath, example)

  if (projectErrors.length > 0 || projectWarnings.length > 0) {
    console.log(`\n📁 ${example}`)

    if (projectErrors.length > 0) {
      console.log(`  ❌ ${projectErrors.length} error(s):`)
      projectErrors.forEach(err => console.log(`     - ${err}`))
      totalErrors += projectErrors.length
    }

    if (projectWarnings.length > 0) {
      console.log(`  ⚠️  ${projectWarnings.length} warning(s):`)
      projectWarnings.forEach(warn => console.log(`     - ${warn}`))
      totalWarnings += projectWarnings.length
    }
  }
}

console.log(`\n${'='.repeat(60)}`)
console.log(`📊 Summary: ${totalErrors} errors, ${totalWarnings} warnings`)

if (totalErrors > 0) {
  console.log('\n❌ Validation failed')
  process.exit(1)
} else {
  console.log('\n✅ All examples valid!')
  process.exit(0)
}
