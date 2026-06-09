#!/usr/bin/env node

// Comprehensive example project validator
//
// Validates all example projects for:
// - JSON validity
// - Node/edge schema compliance
// - Operator type validity
// - Attribute flow correctness
// - Layout sanity
// - Migration completeness
//
// Usage: node scripts/validate-examples.js [--verbose]

const fs = require('fs')
const path = require('path')

const EXAMPLES_DIR = path.join(__dirname, '../noodles-editor/src/examples')
const OPERATORS_FILE = path.join(__dirname, '../noodles-editor/src/noodles/operators.ts')
const TARGET_VERSION = 15

const args = process.argv.slice(2)
const isVerbose = args.includes('--verbose')

// Known operator types (auto-detected from operators.ts)
const VALID_OPERATORS = new Set()

// Load operators from operators.ts
function loadOperators() {
  const content = fs.readFileSync(OPERATORS_FILE, 'utf8')
  const lines = content.split('\n')

  for (const line of lines) {
    const match = line.match(/^export class (\w+Op) extends Operator/)
    if (match) {
      VALID_OPERATORS.add(match[1])
    }
  }

  if (isVerbose) {
    console.log(`📦 Loaded ${VALID_OPERATORS.size} operator types\n`)
  }
}

// Known deprecated operators
const DEPRECATED_OPERATORS = new Set(['AccessorOp'])

// Fields that shouldn't be migrated to attributes
const SKIP_MIGRATION_FIELDS = new Set([
  'getFilterValue',
])

// Layer operator types
const LAYER_OPS = new Set([
  'ScatterplotLayerOp',
  'PathLayerOp',
  'ArcLayerOp',
  'LineLayerOp',
  'IconLayerOp',
  'TextLayerOp',
  'PolygonLayerOp',
  'SolidPolygonLayerOp',
  'GeoJsonLayerOp',
  'ColumnLayerOp',
  'GridLayerOp',
  'GridCellLayerOp',
  'HexagonLayerOp',
  'ContourLayerOp',
  'ScreenGridLayerOp',
  'HeatmapLayerOp',
  'H3HexagonLayerOp',
  'H3ClusterLayerOp',
  'GreatCircleLayerOp',
  'TripsLayerOp',
  'BitmapLayerOp',
  'GeohashLayerOp',
  'S2LayerOp',
  'QuadkeyLayerOp',
  'A5LayerOp',
  'PointCloudLayerOp',
  'ScenegraphLayerOp',
  'SimpleMeshLayerOp',
  'TileLayerOp',
  'Tile3DLayerOp',
  'TerrainLayerOp',
  'MVTLayerOp',
])

// Validate a single project
function validateProject(projectPath, projectName) {
  const errors = []
  const warnings = []
  const stats = {
    nodes: 0,
    edges: 0,
    createAttributeOps: 0,
    accessorOps: 0,
    layerOps: 0,
  }

  let project

  try {
    const content = fs.readFileSync(projectPath, 'utf8')
    project = JSON.parse(content)
  } catch (e) {
    errors.push(`Invalid JSON: ${e.message}`)
    return { errors, warnings, stats }
  }

  // Check version
  if (project.version == null) {
    warnings.push('Missing version field')
  } else if (project.version < TARGET_VERSION) {
    errors.push(`Outdated version ${project.version} (target: ${TARGET_VERSION})`)
  }

  // Validate nodes
  if (!project.nodes || !Array.isArray(project.nodes)) {
    errors.push('Missing or invalid nodes array')
    return { errors, warnings, stats }
  }

  stats.nodes = project.nodes.length

  const nodeIds = new Set()
  const nodeMap = new Map()

  for (const node of project.nodes) {
    if (!node.id) {
      errors.push('Node missing id')
      continue
    }

    nodeIds.add(node.id)
    nodeMap.set(node.id, node)

    if (!node.type) {
      errors.push(`Node ${node.id} missing type`)
      continue
    }

    if (!VALID_OPERATORS.has(node.type)) {
      errors.push(`Node ${node.id} has unknown type: ${node.type}`)
    }

    if (DEPRECATED_OPERATORS.has(node.type)) {
      errors.push(`Node ${node.id} uses deprecated operator: ${node.type}`)
    }

    if (node.type === 'CreateAttributeOp') {
      stats.createAttributeOps++

      // Validate CreateAttributeOp structure
      const inputs = node.data?.inputs || {}
      if (!inputs.name) {
        errors.push(`CreateAttributeOp ${node.id} missing name`)
      }
      if (!inputs.expression) {
        errors.push(`CreateAttributeOp ${node.id} missing expression`)
      }
    }

    if (node.type === 'AccessorOp') {
      stats.accessorOps++
    }

    if (LAYER_OPS.has(node.type)) {
      stats.layerOps++
    }

    if (!node.position) {
      warnings.push(`Node ${node.id} missing position`)
    } else {
      if (node.position.x == null || node.position.y == null) {
        errors.push(`Node ${node.id} has invalid position`)
      }
    }

    if (!node.data || typeof node.data !== 'object') {
      warnings.push(`Node ${node.id} missing data object`)
    }
  }

  // Validate edges
  if (!project.edges || !Array.isArray(project.edges)) {
    errors.push('Missing or invalid edges array')
    return { errors, warnings, stats }
  }

  stats.edges = project.edges.length

  for (const edge of project.edges) {
    if (!edge.id) {
      warnings.push('Edge missing id')
    }

    if (!edge.source) {
      errors.push(`Edge ${edge.id || 'unknown'} missing source`)
    } else if (!nodeIds.has(edge.source)) {
      errors.push(`Edge ${edge.id} references non-existent source: ${edge.source}`)
    }

    if (!edge.target) {
      errors.push(`Edge ${edge.id || 'unknown'} missing target`)
    } else if (!nodeIds.has(edge.target)) {
      errors.push(`Edge ${edge.id} references non-existent target: ${edge.target}`)
    }

    if (!edge.sourceHandle) {
      warnings.push(`Edge ${edge.id} missing sourceHandle`)
    } else {
      // Check for double-prefixed handles (common migration error)
      if (edge.sourceHandle.match(/^out\.out\./)) {
        errors.push(`Edge ${edge.id} has double-prefixed sourceHandle: ${edge.sourceHandle}`)
      }
    }

    if (!edge.targetHandle) {
      warnings.push(`Edge ${edge.id} missing targetHandle`)
    } else {
      if (edge.targetHandle.match(/^par\.par\./)) {
        errors.push(`Edge ${edge.id} has double-prefixed targetHandle: ${edge.targetHandle}`)
      }

      // Check for deprecated accessor connections
      // Color operators connecting to color accessors are OK (uniform values)
      if (edge.targetHandle.startsWith('par.get') && !SKIP_MIGRATION_FIELDS.has(edge.targetHandle.replace('par.', ''))) {
        const sourceNode = nodeMap.get(edge.source)
        const targetNode = nodeMap.get(edge.target)
        const isColorConnection = sourceNode && (sourceNode.type === 'ColorOp' || sourceNode.type === 'ColorRampOp' || sourceNode.type === 'CategoricalColorRampOp')
        const isColorAccessor = edge.targetHandle.includes('Color')

        if (targetNode && LAYER_OPS.has(targetNode.type) && !(isColorConnection && isColorAccessor)) {
          errors.push(`Edge ${edge.id} connects to deprecated accessor field ${edge.targetHandle} (should use attributes)`)
        }
      }
    }
  }

  // Validate CreateAttributeOp flow
  for (const node of project.nodes) {
    if (node.type !== 'CreateAttributeOp') continue

    const hasInputConnection = project.edges.some(
      e => e.target === node.id && e.targetHandle === 'par.data'
    )
    if (!hasInputConnection) {
      warnings.push(`CreateAttributeOp ${node.id} has no data input (orphaned)`)
    }

    const hasOutputConnection = project.edges.some(e => e.source === node.id)
    if (!hasOutputConnection) {
      warnings.push(`CreateAttributeOp ${node.id} has no output connections (unused)`)
    }
  }

  // Validate layer data connections
  for (const node of project.nodes) {
    if (!LAYER_OPS.has(node.type)) continue

    const hasDataConnection = project.edges.some(
      e => e.target === node.id && e.targetHandle === 'par.data'
    )
    if (!hasDataConnection) {
      warnings.push(`Layer ${node.id} has no data input`)
    }
  }

  // Check for layout issues
  const positions = project.nodes.map(n => n.position).filter(p => p && p.x != null && p.y != null)
  if (positions.length > 0) {
    const xs = positions.map(p => p.x)
    const ys = positions.map(p => p.y)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)

    if (minX < -100 || minY < -100) {
      warnings.push('Some nodes have negative positions')
    }

    if (maxX - minX > 5000 || maxY - minY > 3000) {
      warnings.push('Nodes are very spread out (consider re-layout)')
    }

    // Check for overlapping nodes
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const dx = Math.abs(positions[i].x - positions[j].x)
        const dy = Math.abs(positions[i].y - positions[j].y)
        if (dx < 50 && dy < 50) {
          warnings.push('Some nodes are overlapping or very close')
          break
        }
      }
    }
  }

  return { errors, warnings, stats }
}

// Main
function main() {
  console.log('🔍 Comprehensive Example Validator')
  console.log(`   Target version: ${TARGET_VERSION}\n`)

  loadOperators()

  const examples = fs.readdirSync(EXAMPLES_DIR)
  let totalErrors = 0
  let totalWarnings = 0
  const results = []

  for (const example of examples) {
    const noodlesPath = path.join(EXAMPLES_DIR, example, 'noodles.json')

    if (!fs.existsSync(noodlesPath)) {
      continue
    }

    const { errors, warnings, stats } = validateProject(noodlesPath, example)
    results.push({ example, errors, warnings, stats })

    if (errors.length > 0 || warnings.length > 0) {
      console.log(`\n📁 ${example}`)

      if (isVerbose) {
        console.log(`   Nodes: ${stats.nodes}, Edges: ${stats.edges}`)
        console.log(`   CreateAttributeOps: ${stats.createAttributeOps}, AccessorOps: ${stats.accessorOps}, Layers: ${stats.layerOps}`)
      }

      if (errors.length > 0) {
        console.log(`  ❌ ${errors.length} error(s):`)
        errors.forEach(err => console.log(`     - ${err}`))
        totalErrors += errors.length
      }

      if (warnings.length > 0) {
        console.log(`  ⚠️  ${warnings.length} warning(s):`)
        warnings.forEach(warn => console.log(`     - ${warn}`))
        totalWarnings += warnings.length
      }
    } else if (isVerbose) {
      console.log(`✅ ${example}`)
    }
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log(`📊 Summary: ${results.length} projects, ${totalErrors} errors, ${totalWarnings} warnings`)

  if (totalErrors > 0) {
    console.log('\n❌ Validation failed')
    process.exit(1)
  } else {
    console.log('\n✅ All examples valid!')
    process.exit(0)
  }
}

main()
