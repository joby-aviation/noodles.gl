import { readdir, readFile, writeFile } from 'node:fs/promises'
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
      } else if (entry.name.endsWith(extension)) {
        files.push(fullPath)
      }
    }
    return files
  } catch (error) {
    console.error(`Error reading directory ${dir}:`, error.message)
    return []
  }
}

// Simple version 6 -> 7 migration: rename operators
function migrateV6ToV7(project) {
  const { nodes, ...rest } = project

  const newNodes = nodes.map(node => {
    if (node.type === 'MergeOp') {
      return { ...node, type: 'ConcatOp' }
    }
    if (node.type === 'ObjectMergeOp') {
      return { ...node, type: 'MergeOp' }
    }
    return node
  })

  return {
    ...rest,
    nodes: newNodes,
    version: 7
  }
}

// Version 4 -> 7 migration is complex, so we'll skip it for now
// and handle those files separately or manually
function needsComplexMigration(version) {
  return version < 6
}

async function migrateFiles() {
  let migratedCount = 0
  let skippedCount = 0
  let complexMigrationNeeded = []

  for (const dir of EXAMPLES_DIRS) {
    console.log(`\nProcessing directory: ${dir}`)
    const files = await getAllFiles(dir)

    for (const filePath of files) {
      try {
        const content = await readFile(filePath, 'utf8')
        const projectData = JSON.parse(content)

        // Check if this is a noodles project file
        if (typeof projectData.version !== 'number' || !Array.isArray(projectData.nodes)) {
          console.log(`- Skipping ${filePath}: Not a valid noodles project`)
          continue
        }

        const currentVersion = projectData.version

        // Already at target version
        if (currentVersion === TARGET_VERSION) {
          skippedCount++
          console.log(`- No changes needed for ${filePath} (already v${currentVersion})`)
          continue
        }

        // Needs complex migration (v4 or v5 -> v7)
        if (needsComplexMigration(currentVersion)) {
          complexMigrationNeeded.push({ path: filePath, version: currentVersion })
          console.log(`⚠️  ${filePath} (v${currentVersion}) needs complex migration - skipping for now`)
          continue
        }

        // Simple migration (v6 -> v7)
        if (currentVersion === 6) {
          const migrated = migrateV6ToV7(projectData)
          await writeFile(filePath, JSON.stringify(migrated, null, 2) + '\n')
          migratedCount++
          console.log(`✓ Migrated ${filePath} (v${currentVersion} → v${TARGET_VERSION})`)
        } else {
          console.log(`- Unsupported version ${currentVersion} for ${filePath}`)
        }
      } catch (error) {
        console.log(`✗ Error processing ${filePath}: ${error.message}`)
      }
    }
  }

  console.log(`\n=== Migration Summary ===`)
  console.log(`✓ ${migratedCount} file(s) successfully migrated to v${TARGET_VERSION}`)
  console.log(`- ${skippedCount} file(s) already at v${TARGET_VERSION}`)

  if (complexMigrationNeeded.length > 0) {
    console.log(`\n⚠️  ${complexMigrationNeeded.length} file(s) need complex migration:`)
    for (const { path, version } of complexMigrationNeeded) {
      console.log(`   ${path} (v${version})`)
    }
    console.log(`\nThese files require migration through versions 5 and 6. Please use the full migration system for these.`)
  }

  return migratedCount
}

migrateFiles().catch(error => {
  console.error('Migration failed:', error)
  process.exit(1)
})
