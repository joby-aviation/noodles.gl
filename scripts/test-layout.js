const fs = require('fs')
const { calculateNodeLayers } = require('./fix-example-layouts.js')

const data = JSON.parse(fs.readFileSync('noodles-editor/public/examples/3d-building-gradient.json', 'utf8'))

console.log('Nodes:', data.nodes.map(n => n.id))
console.log('\nEdges:')
data.edges.forEach(e => console.log('  ', e.source, '->', e.target))

const { layers, nodeToLayer } = calculateNodeLayers(data.nodes, data.edges)

console.log('\nLayers:', layers)
console.log('\nNode to layer map:')
for (const [node, layer] of nodeToLayer.entries()) {
  console.log('  ', node, '->', layer)
}
