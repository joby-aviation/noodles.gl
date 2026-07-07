#!/usr/bin/env node
// Validates that all noodles.json example files are well-formed project files.
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const root = path.resolve(__dirname, '..')
const examplesDir = path.join(root, 'noodles-editor/src/examples')

let failed = false

const stagedFiles = execSync('git diff --cached --name-only', { encoding: 'utf-8' })
  .split('\n')
  .filter(f => /noodles-editor\/src\/examples\/.+\/noodles\.json$/.test(f))

for (const relPath of stagedFiles) {
  const fullPath = path.join(root, relPath)
  if (!fs.existsSync(fullPath)) continue

  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(fullPath, 'utf-8'))
  } catch (e) {
    console.error(`❌ ${relPath}: invalid JSON — ${e.message}`)
    failed = true
    continue
  }

  if (typeof parsed.version !== 'number') {
    console.error(`❌ ${relPath}: missing or invalid "version" field`)
    failed = true
  }
  if (!Array.isArray(parsed.nodes)) {
    console.error(`❌ ${relPath}: missing or invalid "nodes" array`)
    failed = true
  }
  if (!Array.isArray(parsed.edges)) {
    console.error(`❌ ${relPath}: missing or invalid "edges" array`)
    failed = true
  }
}

if (failed) process.exit(1)
console.log(`✅ All example files valid`)
