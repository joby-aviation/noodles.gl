#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// Validate example projects have valid JSON and correct structure
function validateExampleProject(projectPath) {
  const errors = [];

  try {
    const data = JSON.parse(fs.readFileSync(projectPath, 'utf8'));

    // Check required fields
    if (!data.version) errors.push('Missing version field');
    if (!data.nodes || !Array.isArray(data.nodes)) errors.push('Missing or invalid nodes array');
    if (!data.edges || !Array.isArray(data.edges)) errors.push('Missing or invalid edges array');

    // Validate node IDs exist
    const nodeIds = new Set(data.nodes.map(n => n.id));

    // Validate edges reference existing nodes
    data.edges.forEach((edge, i) => {
      if (!nodeIds.has(edge.source)) {
        errors.push(`Edge ${i}: source "${edge.source}" not found in nodes`);
      }
      if (!nodeIds.has(edge.target)) {
        errors.push(`Edge ${i}: target "${edge.target}" not found in nodes`);
      }
    });

    // Check for generic node names (pattern: /name-\d+)
    const genericPattern = /-\d+$/;
    data.nodes.forEach(node => {
      const nodeName = node.id.replace(/^\//, '');
      if (genericPattern.test(nodeName)) {
        errors.push(`Node "${node.id}" has generic name (ends with -<number>)`);
      }
    });

  } catch (err) {
    errors.push(`Failed to parse JSON: ${err.message}`);
  }

  return errors;
}

// Get all example projects
const examplesDir = path.join(__dirname, '../noodles-editor/src/examples');
const projects = fs.readdirSync(examplesDir)
  .map(dir => path.join(examplesDir, dir, 'noodles.json'))
  .filter(p => fs.existsSync(p));

let hasErrors = false;

projects.forEach(projectPath => {
  const projectName = path.basename(path.dirname(projectPath));
  const errors = validateExampleProject(projectPath);

  if (errors.length > 0) {
    hasErrors = true;
    console.error(`\n❌ ${projectName}:`);
    errors.forEach(err => console.error(`   - ${err}`));
  }
});

if (!hasErrors) {
  console.log('✓ All example projects are valid');
  process.exit(0);
} else {
  process.exit(1);
}
