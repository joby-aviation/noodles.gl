const fs = require('fs');

const filePath = 'noodles-editor/src/examples/california-earthquakes/noodles.json';
const project = JSON.parse(fs.readFileSync(filePath, 'utf8'));

// Find AccessorOp node
const accessorNode = project.nodes.find(n => n.type === 'AccessorOp' && n.id === '/position-accessor');
if (!accessorNode) {
  console.log('No AccessorOp found');
  process.exit(1);
}

const expression = accessorNode.data.inputs.expression;
console.log('Found expression:', expression);

// Remove AccessorOp
project.nodes = project.nodes.filter(n => n.id !== '/position-accessor');

// Add CreateAttributeOp with correct inputs
project.nodes.push({
  id: '/position-accessor-position',
  type: 'CreateAttributeOp',
  position: accessorNode.position,
  data: {
    inputs: {
      name: 'position',
      expression: expression,
      size: 2,
      type: 'float'
    },
    locked: false
  }
});

// Find the data source -> accessor edge
const dataSourceEdge = project.edges.find(e => e.target === '/position-accessor');
if (dataSourceEdge) {
  // Update to point to CreateAttributeOp
  const newEdge = {
    id: dataSourceEdge.id.replace('/position-accessor', '/position-accessor-position'),
    source: dataSourceEdge.source,
    sourceHandle: dataSourceEdge.sourceHandle,
    target: '/position-accessor-position',
    targetHandle: 'par.data'
  };
  project.edges = project.edges.filter(e => e.id !== dataSourceEdge.id);
  project.edges.push(newEdge);
}

// Find the accessor -> layer edge
const layerEdge = project.edges.find(e => e.source === '/position-accessor');
if (layerEdge) {
  // Update to connect data output to layer data input
  const newEdge = {
    id: '/position-accessor-position.out.data->/scatterplot-layer.par.data',
    source: '/position-accessor-position',
    sourceHandle: 'out.data',
    target: '/scatterplot-layer',
    targetHandle: 'par.data'
  };
  project.edges = project.edges.filter(e => e.id !== layerEdge.id);
  project.edges.push(newEdge);
}

// Update version to 15
project.version = 15;

fs.writeFileSync(filePath, JSON.stringify(project, null, 2) + '\n');
console.log('Migration applied successfully!');
console.log('Expression set to:', expression);
