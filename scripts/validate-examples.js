#!/usr/bin/env node
// Validates that all example project JSON files are at the latest schema version.
// Used by the pre-commit hook.

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

async function getMigrationsDir() {
  return join(process.cwd(), 'noodles-editor/src/noodles/__migrations__')
}

async function getLatestVersion() {
  const dir = await getMigrationsDir()
  const files = await readdir(dir)
  const versions = files
    .filter(f => /^\d{3}-/.test(f) && f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map(f => parseInt(f.slice(0, 3), 10))
  return Math.max(...versions)
}

async function getAllJsonFiles(dir) {
  let results = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      results = results.concat(await getAllJsonFiles(fullPath))
    } else if (entry.name.endsWith('.json')) {
      results.push(fullPath)
    }
  }
  return results
}

async function main() {
  const latestVersion = await getLatestVersion()
  const examplesDir = join(process.cwd(), 'noodles-editor/src/examples')
  const publicDir = join(process.cwd(), 'noodles-editor/public/noodles')

  const [exampleFiles, publicFiles] = await Promise.all([
    getAllJsonFiles(examplesDir),
    getAllJsonFiles(publicDir),
  ])
  const files = [...exampleFiles, ...publicFiles]

  const outdated = []
  for (const filePath of files) {
    const content = await readFile(filePath, 'utf8')
    let data
    try {
      data = JSON.parse(content)
    } catch {
      continue
    }
    if (typeof data.version === 'number' && data.version !== latestVersion) {
      outdated.push(`  ${filePath}: version ${data.version} (expected ${latestVersion})`)
    }
  }

  if (outdated.length > 0) {
    console.error(`The following example projects need migration to version ${latestVersion}:\n`)
    outdated.forEach(line => console.error(line))
    console.error('\nRun: npm run migrate:examples')
    process.exit(1)
  }

  console.log(`✅ All example projects are at version ${latestVersion}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
