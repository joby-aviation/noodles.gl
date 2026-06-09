#!/usr/bin/env node

// Fix deprecated accessor field connections by converting them to uniform field values
// This handles cases where a static value (e.g., ColorOp) connects to a layer accessor field

const fs = require('fs')
const path = require('path')

const EXAMPLES_DIR = path.join(__dirname, '../noodles-editor/src/examples')

// Map of deprecated accessor fields that should use uniform values
const DEPRECATED_ACCESSOR_FIELDS = [
  'getPosition',
  'getSourcePosition',
  'getTargetPosition',
  'getFillColor',
  'getLineColor',
  'getSourceColor',
  'getTargetColor',
  'getColor',
  'getRadius',
  'getElevation',
  'getWidth',
  'getHeight',
]

function fixProject(projectPath, projectName) {
  console.log(`\n📁 ${projectName}`)

  const content = fs.readFileSync(projectPath, 'utf8')
  let project

  try {
    project = JSON.parse(content)
  } catch (e) {
    console.error(`  ❌ Invalid JSON: ${e.message}`)
    return false
  }

  const nodeMap = new Map(project.nodes.map(n => [n.id, n]))
  const edgesToRemove = []
  let changesMade = false

  // Find edges connecting to deprecated accessor fields
  for (const edge of project.edges) {
    const fieldName = edge.targetHandle?.replace('par.', '')
    if (!fieldName || !DEPRECATED_ACCESSOR_FIELDS.includes(fieldName)) {
      continue
    }

    const sourceNode = nodeMap.get(edge.source)
    const targetNode = nodeMap.get(edge.target)

    if (!sourceNode || !targetNode) {
      continue
    }

    // Check if source is a static value operator (ColorOp, NumberOp, etc.)
    const isStaticSource = ['ColorOp', 'NumberOp', 'HSLOp', 'ColorRampOp'].includes(sourceNode.type)

    if (isStaticSource) {
      console.log(`  🔧 Removing deprecated connection: ${edge.id}`)
      console.log(`     Source: ${sourceNode.type} (${edge.source})`)
      console.log(`     Field: ${fieldName}`)

      // Get the static value from the source node
      let staticValue = null
      if (sourceNode.type === 'ColorOp') {
        staticValue = sourceNode.data?.inputs?.color
      } else if (sourceNode.type === 'NumberOp') {
        staticValue = sourceNode.data?.inputs?.value
      }

      // Set the value directly on the target field (uniform mode)
      if (staticValue !== null && targetNode.data?.inputs) {
        if (!targetNode.data.inputs[fieldName]) {
          targetNode.data.inputs[fieldName] = staticValue
          console.log(`     ✓ Set ${fieldName} = ${JSON.stringify(staticValue)}`)
        }
      }

      edgesToRemove.push(edge.id)
      changesMade = true
    }
  }

  // Remove the deprecated edges
  project.edges = project.edges.filter(e => !edgesToRemove.includes(e.id))

  if (changesMade) {
    fs.writeFileSync(projectPath, JSON.stringify(project, null, 2) + '\n')
    console.log(`  ✅ Fixed ${edgesToRemove.length} deprecated connection(s)`)
    return true
  } else {
    console.log(`  ⏭️  No deprecated connections found`)
    return false
  }
}

function main() {
  console.log('🔧 Fix Deprecated Accessor Connections')
  console.log('========================================\n')

  const examples = fs.readdirSync(EXAMPLES_DIR)
  let fixedCount = 0

  for (const example of examples) {
    const noodlesPath = path.join(EXAMPLES_DIR, example, 'noodles.json')

    if (!fs.existsSync(noodlesPath)) {
      continue
    }

    if (fixProject(noodlesPath, example)) {
      fixedCount++
    }
  }

  console.log('\n========================================')
  console.log(`📊 Fixed ${fixedCount} projects`)
}

main()
