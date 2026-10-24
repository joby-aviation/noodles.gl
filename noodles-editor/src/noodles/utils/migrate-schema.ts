import { basename } from 'node:path'
import type { InOut } from '../fields'
import { edgeId } from './migration-utils'
import { parseHandleId } from './path-utils'
import type { NoodlesProjectJSON } from './serialization'

const migrations = import.meta.glob(['../__migrations__/*.ts', '!../__migrations__/*.test.ts'])

// Two PRs can add migrations with the same number without a git conflict. Projects
// already saved at that version would skip one of them, so refuse to load instead.
assertUniqueMigrationVersions(Object.keys(migrations))

export const NOODLES_VERSION = Math.max(...Object.keys(migrations).map(versionFromFilename))

export function assertUniqueMigrationVersions(filenames: string[]) {
  const byVersion = new Map<number, string[]>()
  for (const filename of filenames) {
    const version = versionFromFilename(filename)
    byVersion.set(version, [...(byVersion.get(version) ?? []), basename(filename)])
  }
  const next = String(Math.max(...byVersion.keys()) + 1).padStart(3, '0')
  for (const [version, names] of byVersion) {
    if (names.length > 1) {
      const padded = String(version).padStart(3, '0')
      throw new Error(
        `Two migrations use ${padded} (${names.join(', ')}). Rebase on main and renumber yours to ${next}, then update __migrations__/LATEST and bump example project versions`
      )
    }
  }
}

interface IMigration {
  up: (project: NoodlesProjectJSON) => Promise<NoodlesProjectJSON>
  down: (project: NoodlesProjectJSON) => Promise<NoodlesProjectJSON>
}

function versionFromFilename(filename: string) {
  const [version] = basename(filename).match(/^(\d+)/) || []
  if (!version) {
    throw new Error(`Invalid migration filename: ${filename}`)
  }
  return Number(version)
}

export async function migrateProject(
  project: NoodlesProjectJSON,
  { to = NOODLES_VERSION }: { to?: number } = {}
): Promise<NoodlesProjectJSON> {
  if (project.version === to) {
    return project
  }

  let migrated = project
  const migrationVersions = Object.entries(migrations)
    .map(([filename, migration]) => ({
      version: versionFromFilename(filename),
      migration,
    }))
    .sort((a, b) => a.version - b.version)

  // If we're migrating up
  if (to > project.version) {
    for (const { version, migration } of migrationVersions) {
      if (version > migrated.version && version <= to) {
        const migrationModule = await (migration as () => Promise<IMigration>)()
        if (migrationModule.up) {
          migrated = await migrationModule.up(migrated)
          migrated = { ...migrated, version }
        }
      }
    }
  }
  // If we're migrating down
  else if (to < project.version) {
    for (const { version, migration } of migrationVersions.reverse()) {
      if (version <= migrated.version && version > to) {
        const migrationModule = await (migration as () => Promise<IMigration>)()
        if (migrationModule.down) {
          migrated = await migrationModule.down(migrated)
          migrated = { ...migrated, version: version - 1 }
        }
      }
    }
  }

  return migrated
}

export function renameHandle({
  type,
  inOut,
  oldHandle,
  newHandle,
  project,
}: {
  // A Noodles operator type in a schema 1–18 project
  type: string
  inOut: InOut
  oldHandle: string
  newHandle: string
  project: NoodlesProjectJSON
}): NoodlesProjectJSON {
  const { edges, nodes, ...migrated } = project

  const filteredNodes = new Map(
    nodes.filter(node => node.type === type).map(node => [node.id, node])
  )

  if (!filteredNodes.size) {
    return project
  }

  const nodeKey = inOut === 'out' ? 'source' : 'target'
  const handleKey = inOut === 'out' ? 'sourceHandle' : 'targetHandle'
  let found = false
  const newEdges = edges.map(edge => {
    const node = filteredNodes.get(edge[nodeKey])
    if (node && edge[handleKey] === oldHandle) {
      found = true
      const newEdge = {
        ...edge,
        [handleKey]: newHandle,
      }
      return {
        ...newEdge,
        id: edgeId(newEdge),
      }
    }
    return edge
  })

  if (!found) {
    throw new Error(`No edges found for ${oldHandle}. Was there a typo?`)
  }

  const newNodes = nodes.map(node => {
    if (node.type !== type) return node

    // Keep the original handle name for backwards compatibility
    const { fieldName: oldFieldName } = parseHandleId(oldHandle) || { fieldName: oldHandle }
    const { fieldName: newFieldName } = parseHandleId(newHandle) || { fieldName: newHandle }

    if (!oldFieldName) {
      throw new Error(`Invalid handle: ${oldHandle}`)
    }

    type InputKey = keyof typeof node.data.inputs

    const { [oldFieldName as InputKey]: oldValue, ...restOfInputs } = node.data.inputs

    // Only add the new field if the old value existed
    const newInputs =
      oldValue !== undefined
        ? { ...restOfInputs, [newFieldName as InputKey]: oldValue }
        : restOfInputs

    const newNode = {
      ...node,
      data: {
        ...node.data,
        inputs: newInputs,
      },
    }

    return newNode
  })
  // TODO: migrate INPUT theatre state pointers to new handle
  return { ...migrated, nodes: newNodes, edges: newEdges }
}

export function changeDefaultValue({
  project,
  type,
  handle,
  defaultValue,
}: {
  project: NoodlesProjectJSON
  // A Noodles operator type in a schema 1–18 project
  type: string
  handle: string
  defaultValue: unknown
}) {
  const { nodes, ...migrated } = project

  const newNodes = nodes.map(node => {
    if (node.type !== type) return node

    const { [handle]: _, ...restOfInputs } = node.data.inputs

    const newNode = {
      ...node,
      data: {
        ...node.data,
        inputs: {
          ...restOfInputs,
          [handle]: defaultValue,
        },
      },
    }
    return newNode
  })
  return { ...migrated, nodes: newNodes }
}
