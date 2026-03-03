#!/usr/bin/env node
/**
 * Migration Generator CLI
 *
 * Interactive CLI tool for generating schema migration files.
 * Usage: yarn generate:migration
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as readline from 'node:readline'
import type { MigrationParams } from '../src/ai-chat/agents/migration-generator'
import { MigrationGeneratorAgent } from '../src/ai-chat/agents/migration-generator'

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

function question(prompt: string): Promise<string> {
  return new Promise(resolve => {
    rl.question(prompt, resolve)
  })
}

async function main() {
  console.log('🔧 Noodles.gl Migration Generator\n')

  const agent = new MigrationGeneratorAgent()

  // Get existing migrations
  const migrationsDir = path.join(__dirname, '../src/noodles/__migrations__')
  const existingMigrations = fs
    .readdirSync(migrationsDir)
    .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'))

  const nextVersion = agent.getNextVersion(existingMigrations)
  console.log(`📝 Next migration version: ${nextVersion}\n`)

  // Collect migration parameters
  const operatorType = await question('Operator type (e.g., ScatterplotLayerOp): ')

  console.log('\nChange types:')
  console.log('  1. rename_field - Rename an input or output field')
  console.log('  2. rename_operator - Rename an operator type')
  console.log('  3. change_default - Change default value of a field')
  console.log('  4. add_field - Add a new required field')
  console.log('  5. remove_field - Remove a field')

  const changeTypeNum = await question('\nChange type (1-5): ')
  const changeTypes = [
    'rename_field',
    'rename_operator',
    'change_default',
    'add_field',
    'remove_field',
  ]
  const changeType = changeTypes[Number(changeTypeNum) - 1]

  if (!changeType) {
    console.error('Invalid change type')
    rl.close()
    return
  }

  const changes: MigrationParams['changes'] = {}

  // Collect type-specific parameters
  switch (changeType) {
    case 'rename_field': {
      const inOut = await question('Input or output? (in/out): ')
      changes.inOut = inOut as 'in' | 'out'
      changes.oldHandle = await question('Old field name: ')
      changes.newHandle = await question('New field name: ')
      break
    }
    case 'rename_operator': {
      changes.oldType = operatorType
      changes.newType = await question('New operator type: ')
      break
    }
    case 'change_default': {
      const inOut = await question('Input or output? (in/out): ')
      changes.inOut = inOut as 'in' | 'out'
      changes.fieldName = await question('Field name: ')
      const oldDefaultStr = await question('Old default value (JSON): ')
      const newDefaultStr = await question('New default value (JSON): ')
      try {
        changes.oldDefault = JSON.parse(oldDefaultStr)
        changes.newDefault = JSON.parse(newDefaultStr)
      } catch (_e) {
        console.error('Invalid JSON')
        rl.close()
        return
      }
      break
    }
    case 'add_field': {
      changes.fieldName = await question('Field name: ')
      const defaultStr = await question('Default value (JSON): ')
      try {
        changes.newDefault = JSON.parse(defaultStr)
      } catch (_e) {
        console.error('Invalid JSON')
        rl.close()
        return
      }
      break
    }
    case 'remove_field': {
      changes.fieldName = await question('Field name: ')
      const defaultStr = await question('Old default value (JSON, optional): ')
      if (defaultStr) {
        try {
          changes.oldDefault = JSON.parse(defaultStr)
        } catch (_e) {
          console.error('Invalid JSON')
          rl.close()
          return
        }
      }
      break
    }
  }

  // Generate migration
  console.log('\n🔄 Generating migration...\n')

  try {
    const migration = agent.generateMigration(
      {
        operatorType,
        changeType: changeType as MigrationParams['changeType'],
        changes,
      },
      nextVersion
    )

    // Write migration file
    const migrationPath = path.join(migrationsDir, `${migration.filename}.ts`)
    fs.writeFileSync(migrationPath, migration.upCode)
    console.log(`✅ Created migration: ${migration.filename}.ts`)

    // Write test file
    const testPath = path.join(migrationsDir, `${migration.filename}.test.ts`)
    fs.writeFileSync(testPath, migration.testCode)
    console.log(`✅ Created test: ${migration.filename}.test.ts`)

    console.log('\n📋 Next steps:')
    console.log('  1. Review the generated migration files')
    console.log('  2. Update the test assertions with actual test cases')
    console.log('  3. Run tests: yarn test')
    console.log(`  4. Update NOODLES_VERSION in migrate-schema.ts to ${nextVersion}`)
  } catch (error) {
    console.error('❌ Error generating migration:', error)
  }

  rl.close()
}

main().catch(console.error)
