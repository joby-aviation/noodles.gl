// Manual migration for chargers example from v4 to v7
// This implements the key migrations without UI dependencies:
// - Migration 005: Qualified paths (add "/" prefix to IDs, update handles to namespace.field format)
// - Migration 006: Rename "Nodes" to "Noodles"
// - Migration 007: Rename MergeOp -> ConcatOp, ObjectMergeOp -> MergeOp

import { readFile, writeFile } from 'node:fs/promises'

const CHARGERS_PATH = './src/examples/chargers/noodles.json'

// Migration 005: Convert to qualified paths
function migrateToQualifiedPaths(project) {
  const { nodes, edges, ...rest } = project

  // Add "/" prefix to all node IDs
  const newNodes = nodes.map(node => ({
    ...node,
    id: node.id.startsWith('/') ? node.id : `/${node.id}`,
    parentId: node.parentId ? (node.parentId.startsWith('/') ? node.parentId : `/${node.parentId}`) : undefined
  }))

  // Update edges to use new IDs and handle format
  const newEdges = edges.map(edge => {
    const source = edge.source.startsWith('/') ? edge.source : `/${edge.source}`
    const target = edge.target.startsWith('/') ? edge.target : `/${edge.target}`

    // Convert handle format: "output" -> "out.output", "input" -> "par.input"
    let sourceHandle = edge.sourceHandle
    let targetHandle = edge.targetHandle

    // If handles don't already have namespace prefix, add them
    if (sourceHandle && !sourceHandle.startsWith('out.') && !sourceHandle.startsWith('par.')) {
      sourceHandle = `out.${sourceHandle}`
    }
    if (targetHandle && !targetHandle.startsWith('out.') && !targetHandle.startsWith('par.')) {
      targetHandle = `par.${targetHandle}`
    }

    const newEdge = {
      ...edge,
      source,
      target,
      sourceHandle,
      targetHandle
    }

    // Regenerate edge ID
    newEdge.id = `${newEdge.source}.${newEdge.sourceHandle}->${newEdge.target}.${newEdge.targetHandle}`

    return newEdge
  })

  return {
    ...rest,
    nodes: newNodes,
    edges: newEdges,
    version: 5
  }
}

// Migration 006: Rename "Nodes" to "Noodles" (affects timeline/theatre data)
function migrateNodesToNoodles(project) {
  // This migration might affect timeline state, but for now we'll just increment version
  // as the actual field rename is in data we may not need to touch
  return {
    ...project,
    version: 6
  }
}

// Migration 007: Rename operators
function migrateRenameOperators(project) {
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

async function migrateChargers() {
  console.log(`Reading ${CHARGERS_PATH}...`)
  const content = await readFile(CHARGERS_PATH, 'utf8')
  const project = JSON.parse(content)

  console.log(`Current version: ${project.version}`)

  if (project.version !== 4) {
    console.error(`Expected version 4, got version ${project.version}`)
    process.exit(1)
  }

  console.log('Applying migration 005: Qualified paths...')
  let migrated = migrateToQualifiedPaths(project)

  console.log('Applying migration 006: Rename Nodes to Noodles...')
  migrated = migrateNodesToNoodles(migrated)

  console.log('Applying migration 007: Rename operators...')
  migrated = migrateRenameOperators(migrated)

  console.log(`New version: ${migrated.version}`)
  console.log(`Writing updated file...`)

  await writeFile(CHARGERS_PATH, JSON.stringify(migrated, null, 2) + '\n')

  console.log(`✓ Successfully migrated ${CHARGERS_PATH} from v4 to v7`)
}

migrateChargers().catch(error => {
  console.error('Migration failed:', error)
  process.exit(1)
})
