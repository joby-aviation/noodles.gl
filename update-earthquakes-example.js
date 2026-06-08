#!/usr/bin/env node
/**
 * Update california-earthquakes example to use Houdini-style attribute flow
 *
 * Replaces the complex CreateAttributeOp expressions with a clean pipeline:
 * CreateAttributeOp (extract magnitude) → MapRangeOp (normalize) → ColorRampOp (apply colormap)
 *
 * This demonstrates the Phase 2 attribute-based data flow capabilities.
 */

const fs = require('fs')
const path = require('path')

const projectPath = path.join(__dirname, 'noodles-editor/src/examples/california-earthquakes/noodles.json')

console.log('📝 Updating california-earthquakes example...\n')

// Load the project
const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'))

// Find nodes we need to modify
const createRadiusNode = project.nodes.find(n => n.id === '/create-radius')
const createColorNode = project.nodes.find(n => n.id === '/create-color')
const scatterplotNode = project.nodes.find(n => n.id === '/scatterplot-layer')

if (!createRadiusNode || !createColorNode || !scatterplotNode) {
  console.error('❌ Could not find required nodes')
  process.exit(1)
}

// Step 1: Create a new CreateAttributeOp to extract magnitude as a float attribute
const createMagnitudeNode = {
  id: '/create-magnitude',
  type: 'CreateAttributeOp',
  data: {
    inputs: {
      name: 'magnitude',
      expression: 'd.Magnitude',
      size: 1,
      type: 'float32'
    }
  },
  position: {
    x: 700,
    y: 100
  }
}

// Step 2: Create MapRangeOp to normalize magnitude (2.5-7 → 0-1) and map to radius (0-10000)
const mapRangeRadiusNode = {
  id: '/map-radius',
  type: 'MapRangeOp',
  data: {
    inputs: {
      inputAttribute: 'magnitude',
      outputAttribute: 'radius',
      fromMin: 2.5,
      fromMax: 7.0,
      toMin: 500,
      toMax: 10000
    }
  },
  position: {
    x: 1100,
    y: 100
  }
}

// Step 3: Create another MapRangeOp to normalize magnitude for color (2.5-7 → 0-1)
const mapRangeColorNode = {
  id: '/map-color-input',
  type: 'MapRangeOp',
  data: {
    inputs: {
      inputAttribute: 'magnitude',
      outputAttribute: 'normalizedMagnitude',
      fromMin: 2.5,
      fromMax: 7.0,
      toMin: 0,
      toMax: 1
    }
  },
  position: {
    x: 1100,
    y: 250
  }
}

// Step 4: Create ColorRampOp to apply turbo colormap
const colorRampNode = {
  id: '/color-ramp',
  type: 'ColorRampOp',
  data: {
    inputs: {
      inputAttribute: 'normalizedMagnitude',
      outputAttribute: 'fillColor',
      interpolator: 'interpolateTurbo'
    }
  },
  position: {
    x: 1500,
    y: 100
  }
}

// Remove old create-radius and create-color nodes
project.nodes = project.nodes.filter(n => n.id !== '/create-radius' && n.id !== '/create-color')

// Add new nodes
project.nodes.push(createMagnitudeNode, mapRangeRadiusNode, mapRangeColorNode, colorRampNode)

// Update edges
// Remove old edges
project.edges = project.edges.filter(e => {
  return e.source !== '/create-radius' &&
         e.source !== '/create-color' &&
         e.target !== '/create-radius' &&
         e.target !== '/create-color'
})

// Add new edges - linear pipeline where attributes accumulate:
// create-position → create-magnitude → map-radius → map-color-input → color-ramp → scatterplot

project.edges.push({
  id: '/create-position.out.data->/create-magnitude.par.data',
  source: '/create-position',
  sourceHandle: 'out.data',
  target: '/create-magnitude',
  targetHandle: 'par.data'
})

project.edges.push({
  id: '/create-magnitude.out.data->/map-radius.par.data',
  source: '/create-magnitude',
  sourceHandle: 'out.data',
  target: '/map-radius',
  targetHandle: 'par.data'
})

project.edges.push({
  id: '/map-radius.out.data->/map-color-input.par.data',
  source: '/map-radius',
  sourceHandle: 'out.data',
  target: '/map-color-input',
  targetHandle: 'par.data'
})

project.edges.push({
  id: '/map-color-input.out.data->/color-ramp.par.data',
  source: '/map-color-input',
  sourceHandle: 'out.data',
  target: '/color-ramp',
  targetHandle: 'par.data'
})

project.edges.push({
  id: '/color-ramp.out.data->/scatterplot-layer.par.data',
  source: '/color-ramp',
  sourceHandle: 'out.data',
  target: '/scatterplot-layer',
  targetHandle: 'par.data'
})

// Update scatterplot node positions
scatterplotNode.position.x = 1900

// Save the updated project
fs.writeFileSync(projectPath, JSON.stringify(project, null, 2) + '\n')

console.log('✅ Updated california-earthquakes example with Houdini-style attribute flow:')
console.log('   CreateAttributeOp (extract magnitude)')
console.log('   → MapRangeOp (normalize to 0-1 for color)')
console.log('   → MapRangeOp (map to radius 500-10000)')
console.log('   → ColorRampOp (apply turbo colormap)')
console.log('   → ScatterplotLayer\n')
console.log('👁️  View at: http://localhost:5173/examples/california-earthquakes\n')
