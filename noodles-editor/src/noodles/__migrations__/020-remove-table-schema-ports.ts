import { inferSchema, isTableSchema, type TableSchema } from '../table-schema'
import { parseHandleId } from '../utils/path-utils'
import type { NoodlesProjectJSON, ProjectMigrationDiagnostic } from '../utils/serialization'

type ProjectNode = NoodlesProjectJSON['nodes'][number]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function inputsFor(node: ProjectNode): Record<string, unknown> {
  if (!isRecord(node.data) || !isRecord(node.data.inputs)) return {}
  return node.data.inputs
}

function isSchemaInputHandle(handle: string | null | undefined) {
  if (handle === 'schema') return true
  const parsed = parseHandleId(handle ?? '')
  return parsed?.namespace === 'par' && parsed.fieldName === 'schema'
}

function isSchemaOutputHandle(handle: string | null | undefined) {
  if (handle === 'schema') return true
  const parsed = parseHandleId(handle ?? '')
  return parsed?.namespace === 'out' && parsed.fieldName === 'schema'
}

function isTableSchemaHandle(handle: string | null | undefined) {
  return isSchemaInputHandle(handle) || isSchemaOutputHandle(handle)
}

/**
 * Materialize the value of the former TableEditor schema ports before removing them.
 * A target's persisted schema is already an effective snapshot, so it wins over its edge.
 */
export async function up(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  const migrationDiagnostics: ProjectMigrationDiagnostic[] = []
  const report = (message: string) => {
    console.warn(`[migration 020] ${message}`)
    migrationDiagnostics.push({ type: 'stale-edge', message })
  }
  const nodesById = new Map(project.nodes.map(node => [node.id, node]))
  const incomingSchemaEdges = new Map<string, NoodlesProjectJSON['edges']>()

  for (const edge of project.edges) {
    const target = nodesById.get(edge.target)
    if (target?.type !== 'TableEditorOp' || !isSchemaInputHandle(edge.targetHandle)) continue
    const source = nodesById.get(edge.source)
    if (source?.type !== 'TableEditorOp' || !isSchemaOutputHandle(edge.sourceHandle)) {
      report(
        `Could not resolve schema connection ${edge.id}; the source is not a TableEditor schema output.`
      )
    }
    const incoming = incomingSchemaEdges.get(target.id) ?? []
    incoming.push(edge)
    incomingSchemaEdges.set(target.id, incoming)
  }

  const resolved = new Map<string, TableSchema>()
  const resolving = new Set<string>()

  const resolveTableSchema = (nodeId: string): TableSchema | undefined => {
    const cached = resolved.get(nodeId)
    if (cached) return cached

    const node = nodesById.get(nodeId)
    if (!node || node.type !== 'TableEditorOp') return undefined

    if (resolving.has(nodeId)) {
      report(`Schema connection cycle at ${nodeId}; falling back to stored table data.`)
      return undefined
    }

    resolving.add(nodeId)
    const inputs = inputsFor(node)
    let schema: TableSchema | undefined

    if (inputs.schema !== undefined && inputs.schema !== null) {
      if (isTableSchema(inputs.schema)) {
        schema = inputs.schema
      } else {
        report(`Ignored malformed persisted schema on ${nodeId}.`)
      }
    }

    if (!schema) {
      const incoming = incomingSchemaEdges.get(nodeId) ?? []
      if (incoming.length > 1) {
        report(`Multiple schema connections target ${nodeId}; using the last connection.`)
      }
      const edge = incoming.at(-1)
      if (edge) {
        const source = nodesById.get(edge.source)
        if (source?.type === 'TableEditorOp' && isSchemaOutputHandle(edge.sourceHandle)) {
          schema = resolveTableSchema(source.id)
        }
      }
    }

    if (!schema) {
      const data = inputs.data
      if (Array.isArray(data)) {
        schema = inferSchema(data)
      } else {
        schema = { columns: [] }
      }
    }

    resolving.delete(nodeId)
    resolved.set(nodeId, schema)
    return schema
  }

  const inputUpdates = new Map<string, Record<string, unknown>>()
  const setInput = (nodeId: string, fieldName: string, value: unknown) => {
    const node = nodesById.get(nodeId)
    if (!node) return
    const updates = inputUpdates.get(nodeId) ?? { ...inputsFor(node) }
    updates[fieldName] = value
    inputUpdates.set(nodeId, updates)
  }

  // Every legacy TableEditor derived an effective schema at runtime, even without
  // a schema edge. Materialize that snapshot now so later row deletion cannot
  // erase an inferred schema after the runtime output port is removed.
  for (const node of project.nodes) {
    if (node.type !== 'TableEditorOp') continue
    setInput(node.id, 'schema', resolveTableSchema(node.id) ?? { columns: [] })
  }

  // A non-TableEditor consumer also needs the former output value copied locally.
  for (const edge of project.edges) {
    const source = nodesById.get(edge.source)
    const target = nodesById.get(edge.target)
    if (source?.type !== 'TableEditorOp' || !isSchemaOutputHandle(edge.sourceHandle)) {
      continue
    }
    if (!target) {
      report(`Could not materialize schema connection ${edge.id}; the target node is missing.`)
      continue
    }
    if (target.type === 'TableEditorOp' && isSchemaInputHandle(edge.targetHandle)) continue

    const targetHandle = parseHandleId(edge.targetHandle ?? '')
    if (!targetHandle || targetHandle.namespace !== 'par') {
      report(`Could not materialize schema connection ${edge.id}; invalid target handle.`)
      continue
    }
    if (Object.hasOwn(inputsFor(target), targetHandle.fieldName)) continue
    setInput(
      edge.target,
      targetHandle.fieldName,
      resolveTableSchema(edge.source) ?? { columns: [] }
    )
  }

  const nodes = project.nodes.map(node => {
    const inputs = inputUpdates.get(node.id)
    const data = isRecord(node.data) ? node.data : {}
    const visibleInputs = Array.isArray(data.visibleInputs)
      ? data.visibleInputs.filter(value => value !== 'schema')
      : undefined
    const visibilityChanged =
      node.type === 'TableEditorOp' &&
      Array.isArray(data.visibleInputs) &&
      visibleInputs?.length !== data.visibleInputs.length

    if (!inputs && !visibilityChanged) return node

    return {
      ...node,
      data: {
        ...data,
        ...(inputs && { inputs }),
        ...(visibilityChanged && { visibleInputs }),
      },
    }
  })

  const edges = project.edges.filter(edge => {
    const source = nodesById.get(edge.source)
    const target = nodesById.get(edge.target)
    return !(
      (source?.type === 'TableEditorOp' && isTableSchemaHandle(edge.sourceHandle)) ||
      (target?.type === 'TableEditorOp' && isTableSchemaHandle(edge.targetHandle))
    )
  })

  return {
    ...project,
    nodes,
    edges,
    ...(migrationDiagnostics.length > 0 && { migrationDiagnostics }),
  }
}

// Removed live relationships cannot be reconstructed safely. Materialized values remain valid in v19.
export async function down(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  return project
}
