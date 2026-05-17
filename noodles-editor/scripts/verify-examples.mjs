// Simple verification script to check all examples are valid JSON with version 7
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const EXAMPLES_DIRS = ['./src/examples']
const TARGET_VERSION = 7

async function getAllFiles(dir, extension = '.json') {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    const files = []

    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        files.push(...(await getAllFiles(fullPath, extension)))
      } else if (entry.name === 'noodles.json') {
        files.push(fullPath)
      }
    }
    return files
  } catch (error) {
    return []
  }
}

async function verifyExamples() {
  let validCount = 0
  let errorCount = 0
  const errors = []

  for (const dir of EXAMPLES_DIRS) {
    const files = await getAllFiles(dir)

    for (const filePath of files) {
      try {
        const content = await readFile(filePath, 'utf8')
        const project = JSON.parse(content)

        // Check version
        if (project.version !== TARGET_VERSION) {
          errors.push(`${filePath}: Expected version ${TARGET_VERSION}, got ${project.version}`)
          errorCount++
          continue
        }

        // Check has required fields
        if (!Array.isArray(project.nodes)) {
          errors.push(`${filePath}: Missing nodes array`)
          errorCount++
          continue
        }

        if (!Array.isArray(project.edges)) {
          errors.push(`${filePath}: Missing edges array`)
          errorCount++
          continue
        }

        // Check all nodes have "/" prefix
        for (const node of project.nodes) {
          if (!node.id.startsWith('/')) {
            errors.push(`${filePath}: Node ID "${node.id}" missing "/" prefix`)
            errorCount++
            break
          }
        }

        // Check all edges use new handle format
        for (const edge of project.edges) {
          if (edge.sourceHandle && !edge.sourceHandle.startsWith('out.') && !edge.sourceHandle.startsWith('par.')) {
            errors.push(`${filePath}: Edge sourceHandle "${edge.sourceHandle}" not in namespace.field format`)
            errorCount++
            break
          }
          if (edge.targetHandle && !edge.targetHandle.startsWith('out.') && !edge.targetHandle.startsWith('par.')) {
            errors.push(`${filePath}: Edge targetHandle "${edge.targetHandle}" not in namespace.field format`)
            errorCount++
            break
          }
        }

        // Check timeline uses "Noodles" not "Nodes" (v6+ requirement)
        if (project.timeline?.sheetsById?.Nodes) {
          errors.push(`${filePath}: timeline.sheetsById.Nodes should be renamed to timeline.sheetsById.Noodles (v6+ requirement)`)
          errorCount++
          continue
        }

        validCount++
        console.log(`✓ ${filePath}`)
      } catch (error) {
        errors.push(`${filePath}: ${error.message}`)
        errorCount++
      }
    }
  }

  console.log(`\n=== Verification Summary ===`)
  console.log(`✓ ${validCount} file(s) valid`)

  if (errorCount > 0) {
    console.log(`✗ ${errorCount} file(s) with errors:\n`)
    errors.forEach(err => console.log(`  ${err}`))
    process.exit(1)
  } else {
    console.log(`\nAll examples successfully migrated to version ${TARGET_VERSION}!`)
  }
}

verifyExamples().catch(error => {
  console.error('Verification failed:', error)
  process.exit(1)
})
