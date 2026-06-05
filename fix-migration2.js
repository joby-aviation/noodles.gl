const fs = require('fs');

const filePath = 'noodles-editor/src/examples/california-earthquakes/noodles.json';
const project = JSON.parse(fs.readFileSync(filePath, 'utf8'));

// Remove the direct data-source -> scatterplot edge
project.edges = project.edges.filter(e =>
  !(e.source === '/data-source' && e.target === '/scatterplot-layer' && e.targetHandle === 'par.data')
);

// Add data-source -> CreateAttributeOp edge
project.edges.push({
  id: '/data-source.out.data->/position-accessor-position.par.data',
  source: '/data-source',
  sourceHandle: 'out.data',
  target: '/position-accessor-position',
  targetHandle: 'par.data'
});

fs.writeFileSync(filePath, JSON.stringify(project, null, 2) + '\n');
console.log('Fixed data flow: data-source -> CreateAttributeOp -> scatterplot');
