import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { migrateProject } from '../src/visualizations/noodles/utils/migrate-schema.js'

const PUBLIC_NOODLES_DIR = './public/noodles'

async function getAllFiles(dir: string, extension = '.json'): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await getAllFiles(fullPath, extension)))
    } else if (entry.name.endsWith(extension)) {
      files.push(fullPath)
    }
  }
  return files
}

async function migrateFiles() {
  try {
    const files = await getAllFiles(PUBLIC_NOODLES_DIR)
    let migratedCount = 0

    for (const filePath of files) {
      try {
        const content = await readFile(filePath, 'utf8')
        const projectData = JSON.parse(content)

        // Check if this is a noodles project file (has version and nodes properties)
        if (typeof projectData.version === 'number' && Array.isArray(projectData.nodes)) {
          console.log(`Migrating: ${filePath}`)
          const migrated = await migrateProject(projectData)

          // Only write if the project was actually changed
          if (JSON.stringify(migrated) !== JSON.stringify(projectData)) {
            await writeFile(filePath, JSON.stringify(migrated, null, 2))
            migratedCount++
            console.log(`✓ Migrated ${filePath}`)
          } else {
            console.log(`- No changes needed for ${filePath}`)
          }
        }
      } catch (error) {
        console.log(`Skipping ${filePath}: ${(error as Error).message}`)
      }
    }

    console.log(`\nMigration complete. ${migratedCount} file(s) updated.`)
    return migratedCount
  } catch (error) {
    console.error('Migration failed:', error)
    process.exit(1)
  }
}

migrateFiles()
