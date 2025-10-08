import { basename } from 'node:path'
import type { InOut } from '../fields'
import type { OpType } from '../operators'
import { edgeId } from './id-utils'
import { parseHandleId } from './path-utils'
import type { NoodlesProjectJSON } from './serialization'

const migrations = import.meta.glob(['../__migrations__/*.ts', '!../__migrations__/*.test.ts'], {
  eager: true,
})

export const NODES_VERSION = Math.max(...Object.keys(migrations).map(versionFromFilename))

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
  { to = NODES_VERSION }: { to?: number } = {}
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
        const migrationModule = migration as IMigration
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
        const migrationModule = migration as IMigration
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
  type: OpType
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

    const newNode = {
      ...node,
      data: {
        ...node.data,
        inputs: {
          ...restOfInputs,
          [newFieldName as InputKey]: oldValue,
        },
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
  type: OpType
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
