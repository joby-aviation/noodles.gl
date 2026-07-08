// Migration Generator Agent
//
// Generates schema migration files for operator changes.
// This is a CLI tool for developers, not usable from AI chat.

export interface MigrationParams {
  operatorType: string
  changeType: 'rename_field' | 'change_default' | 'add_field' | 'remove_field' | 'rename_operator'
  changes: {
    inOut?: 'in' | 'out'
    oldHandle?: string
    newHandle?: string
    fieldName?: string
    oldDefault?: unknown
    newDefault?: unknown
    oldType?: string
    newType?: string
  }
}

export interface GeneratedMigration {
  version: number
  filename: string
  upCode: string
  downCode: string
  testCode: string
}

export class MigrationGeneratorAgent {
  // Generate a migration file for an operator change
  generateMigration(params: MigrationParams, nextVersion: number): GeneratedMigration {
    const { operatorType, changeType, changes } = params

    // Generate descriptive filename
    const filename = this.generateFilename(nextVersion, changeType, operatorType, changes)

    // Generate migration code based on change type
    let upCode: string
    let downCode: string

    switch (changeType) {
      case 'rename_field':
        ;({ upCode, downCode } = this.generateRenameFieldMigration(operatorType, changes))
        break
      case 'rename_operator':
        ;({ upCode, downCode } = this.generateRenameOperatorMigration(changes))
        break
      case 'change_default':
        ;({ upCode, downCode } = this.generateChangeDefaultMigration(operatorType, changes))
        break
      case 'add_field':
        ;({ upCode, downCode } = this.generateAddFieldMigration(operatorType, changes))
        break
      case 'remove_field':
        ;({ upCode, downCode } = this.generateRemoveFieldMigration(operatorType, changes))
        break
      default:
        throw new Error(`Unknown change type: ${changeType}`)
    }

    // Generate test code
    const testCode = this.generateTestCode(filename, operatorType, changeType, changes)

    return {
      version: nextVersion,
      filename,
      upCode,
      downCode,
      testCode,
    }
  }

  // Get the next migration version number
  getNextVersion(existingMigrations: string[]): number {
    const versions = existingMigrations
      .map(file => {
        const match = file.match(/^(\d+)-/)
        return match ? Number.parseInt(match[1], 10) : 0
      })
      .filter(v => v > 0)

    return versions.length > 0 ? Math.max(...versions) + 1 : 1
  }

  // Private helper methods

  private generateFilename(
    version: number,
    changeType: string,
    operatorType: string,
    changes: MigrationParams['changes']
  ): string {
    const versionStr = version.toString().padStart(3, '0')
    const opName = operatorType.replace(/Op$/, '').toLowerCase()

    switch (changeType) {
      case 'rename_field':
        return `${versionStr}-${opName}-${changes.oldHandle}-to-${changes.newHandle}`
      case 'rename_operator':
        return `${versionStr}-rename-${changes.oldType}-to-${changes.newType}`
      case 'change_default':
        return `${versionStr}-${opName}-change-${changes.fieldName}-default`
      case 'add_field':
        return `${versionStr}-${opName}-add-${changes.fieldName}`
      case 'remove_field':
        return `${versionStr}-${opName}-remove-${changes.fieldName}`
      default:
        return `${versionStr}-${opName}-migration`
    }
  }

  private generateRenameFieldMigration(
    operatorType: string,
    changes: MigrationParams['changes']
  ): { upCode: string; downCode: string } {
    const { inOut, oldHandle, newHandle } = changes

    if (!inOut || !oldHandle || !newHandle) {
      throw new Error('rename_field requires inOut, oldHandle, and newHandle')
    }

    const upCode = `import { renameHandle } from '../utils/migrate-schema'
import type { NoodlesProjectJSON } from '../utils/serialization'

// Rename \`${oldHandle}\` to \`${newHandle}\` in ${operatorType}
export async function up(project: NoodlesProjectJSON) {
  return renameHandle({
    type: '${operatorType}',
    inOut: '${inOut}',
    oldHandle: '${oldHandle}',
    newHandle: '${newHandle}',
    project,
  })
}

// Revert the migration by renaming \`${newHandle}\` back to \`${oldHandle}\`
export async function down(project: NoodlesProjectJSON) {
  return renameHandle({
    type: '${operatorType}',
    inOut: '${inOut}',
    oldHandle: '${newHandle}',
    newHandle: '${oldHandle}',
    project,
  })
}
`

    return { upCode, downCode: upCode }
  }

  private generateRenameOperatorMigration(changes: MigrationParams['changes']): {
    upCode: string
    downCode: string
  } {
    const { oldType, newType } = changes

    if (!oldType || !newType) {
      throw new Error('rename_operator requires oldType and newType')
    }

    const upCode = `import type { NoodlesProjectJSON } from '../utils/serialization'

// Rename operator type from ${oldType} to ${newType}
export async function up(project: NoodlesProjectJSON) {
  const nodes = project.nodes || []

  for (const node of nodes) {
    if (node.type === '${oldType}') {
      node.type = '${newType}'
    }
  }

  return project
}

// Revert by renaming ${newType} back to ${oldType}
export async function down(project: NoodlesProjectJSON) {
  const nodes = project.nodes || []

  for (const node of nodes) {
    if (node.type === '${newType}') {
      node.type = '${oldType}'
    }
  }

  return project
}
`

    return { upCode, downCode: upCode }
  }

  private generateChangeDefaultMigration(
    operatorType: string,
    changes: MigrationParams['changes']
  ): { upCode: string; downCode: string } {
    const { inOut, fieldName, oldDefault, newDefault } = changes

    if (!inOut || !fieldName) {
      throw new Error('change_default requires inOut and fieldName')
    }

    const upCode = `import { changeDefaultValue } from '../utils/migrate-schema'
import type { NoodlesProjectJSON } from '../utils/serialization'

// Change default value of ${fieldName} in ${operatorType}
export async function up(project: NoodlesProjectJSON) {
  return changeDefaultValue({
    type: '${operatorType}',
    inOut: '${inOut}',
    handle: '${fieldName}',
    oldValue: ${JSON.stringify(oldDefault)},
    newValue: ${JSON.stringify(newDefault)},
    project,
  })
}

// Revert by changing back to old default
export async function down(project: NoodlesProjectJSON) {
  return changeDefaultValue({
    type: '${operatorType}',
    inOut: '${inOut}',
    handle: '${fieldName}',
    oldValue: ${JSON.stringify(newDefault)},
    newValue: ${JSON.stringify(oldDefault)},
    project,
  })
}
`

    return { upCode, downCode: upCode }
  }

  private generateAddFieldMigration(
    operatorType: string,
    changes: MigrationParams['changes']
  ): { upCode: string; downCode: string } {
    const { fieldName, newDefault } = changes

    if (!fieldName) {
      throw new Error('add_field requires fieldName')
    }

    const upCode = `import type { NoodlesProjectJSON } from '../utils/serialization'

// Add new field ${fieldName} to ${operatorType} with default value
export async function up(project: NoodlesProjectJSON) {
  const nodes = project.nodes || []

  for (const node of nodes) {
    if (node.type === '${operatorType}') {
      // Initialize field with default value if not present
      if (node.data?.inputs && !(${JSON.stringify(fieldName)} in node.data.inputs)) {
        node.data.inputs.${fieldName} = ${JSON.stringify(newDefault)}
      }
    }
  }

  return project
}

// Revert by removing the field
export async function down(project: NoodlesProjectJSON) {
  const nodes = project.nodes || []

  for (const node of nodes) {
    if (node.type === '${operatorType}') {
      if (node.data?.inputs) {
        delete node.data.inputs.${fieldName}
      }
    }
  }

  return project
}
`

    return { upCode, downCode: upCode }
  }

  private generateRemoveFieldMigration(
    operatorType: string,
    changes: MigrationParams['changes']
  ): { upCode: string; downCode: string } {
    const { fieldName, oldDefault } = changes

    if (!fieldName) {
      throw new Error('remove_field requires fieldName')
    }

    const upCode = `import type { NoodlesProjectJSON } from '../utils/serialization'

// Remove field ${fieldName} from ${operatorType}
export async function up(project: NoodlesProjectJSON) {
  const nodes = project.nodes || []

  for (const node of nodes) {
    if (node.type === '${operatorType}') {
      if (node.data?.inputs) {
        delete node.data.inputs.${fieldName}
      }
    }
  }

  return project
}

// Revert by adding the field back with old default
export async function down(project: NoodlesProjectJSON) {
  const nodes = project.nodes || []

  for (const node of nodes) {
    if (node.type === '${operatorType}') {
      if (node.data?.inputs && !(${JSON.stringify(fieldName)} in node.data.inputs)) {
        node.data.inputs.${fieldName} = ${JSON.stringify(oldDefault)}
      }
    }
  }

  return project
}
`

    return { upCode, downCode: upCode }
  }

  private generateTestCode(
    filename: string,
    operatorType: string,
    _changeType: string,
    _changes: MigrationParams['changes']
  ): string {
    return `import { describe, expect, it } from 'vitest'
import type { NoodlesProjectJSON } from '../utils/serialization'
import { down, up } from './${filename}'

describe('${filename}', () => {
  it('should migrate up correctly', async () => {
    const project: NoodlesProjectJSON = {
      version: 1,
      nodes: [
        {
          id: '/test',
          type: '${operatorType}',
          position: { x: 0, y: 0 },
          data: {
            inputs: {
              // TODO: Add test inputs
            },
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }

    const migrated = await up(project)

    // TODO: Add assertions for the migration
    expect(migrated).toBeDefined()
  })

  it('should migrate down correctly', async () => {
    const project: NoodlesProjectJSON = {
      version: 2,
      nodes: [
        {
          id: '/test',
          type: '${operatorType}',
          position: { x: 0, y: 0 },
          data: {
            inputs: {
              // TODO: Add test inputs for down migration
            },
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }

    const reverted = await down(project)

    // TODO: Add assertions for the revert
    expect(reverted).toBeDefined()
  })

  it('should be reversible', async () => {
    const original: NoodlesProjectJSON = {
      version: 1,
      nodes: [
        {
          id: '/test',
          type: '${operatorType}',
          position: { x: 0, y: 0 },
          data: {
            inputs: {},
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }

    const migrated = await up(original)
    const reverted = await down(migrated)

    // TODO: Verify that down(up(project)) === project
    expect(reverted).toEqual(original)
  })
})
`
  }
}
