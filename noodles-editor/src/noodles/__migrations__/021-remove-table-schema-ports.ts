import { fnRe, mustacheRe } from '../fields'
import {
  inferSchema,
  isTableSchema,
  repairTableSchema,
  type TableSchema,
  validateValue,
} from '../table-schema'
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

function inferredSchemaPreservesData(data: unknown[], schema: TableSchema): boolean {
  const columnNames = new Set(schema.columns.map(column => column.name))

  return data.every(row => {
    // Legacy TableEditors passed non-record rows through unchanged, and still do when a
    // schema is present. Only record rows can lose keys or have values reset.
    if (!isRecord(row)) return true

    const rowKeys = Object.keys(row)
    if (rowKeys.length !== columnNames.size || rowKeys.some(key => !columnNames.has(key))) {
      return false
    }

    return schema.columns.every(column => {
      const value = row[column.name]
      return value !== undefined && validateValue(value, column)
    })
  })
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

function containsRemovedSchemaReference(value: unknown): boolean {
  if (typeof value === 'string') {
    return [...value.matchAll(mustacheRe), ...value.matchAll(fnRe)].some(({ groups }) => {
      const fieldPath = groups?.fieldPath
      return groups?.inOut === 'out' && (fieldPath === 'schema' || fieldPath?.startsWith('schema.'))
    })
  }
  if (Array.isArray(value)) return value.some(containsRemovedSchemaReference)
  return isRecord(value) && Object.values(value).some(containsRemovedSchemaReference)
}

/**
 * Materialize the value of the former TableEditor schema ports before removing them.
 * A target's persisted schema is already an effective snapshot, so it wins over its edge.
 */
export async function up(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  const migrationDiagnostics: ProjectMigrationDiagnostic[] = []
  const report = (message: string) => {
    console.warn(`[migration 021] ${message}`)
    migrationDiagnostics.push({ type: 'migration', message })
  }
  const nodesById = new Map(project.nodes.map(node => [node.id, node]))
  const incomingSchemaEdges = new Map<string, NoodlesProjectJSON['edges']>()

  for (const node of project.nodes) {
    if (containsRemovedSchemaReference(inputsFor(node))) {
      report(
        `${node.id} contains a reference to the removed TableEditor .out.schema output; update it manually.`
      )
    }
  }

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
    if (node?.type !== 'TableEditorOp') return undefined

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
        const repaired = repairTableSchema(inputs.schema)
        if (repaired) {
          schema = repaired
          report(`Repaired a legacy persisted schema on ${nodeId}.`)
        } else {
          report(`Ignored malformed persisted schema on ${nodeId}.`)
        }
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
      // Only saved rows can reconstruct the runtime snapshot. A table whose rows arrive
      // from a connection has nothing to materialize, and saving an empty column list
      // would validate every incoming row down to `{}`, so leave the schema unresolved.
      const data = inputs.data
      const inferred = Array.isArray(data) ? inferSchema(data) : undefined
      if (
        inferred &&
        inferred.columns.length > 0 &&
        inferredSchemaPreservesData(data as unknown[], inferred)
      ) {
        schema = inferred
      }
    }

    resolving.delete(nodeId)
    if (schema) resolved.set(nodeId, schema)
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
    const schema = resolveTableSchema(node.id)
    if (schema) {
      setInput(node.id, 'schema', schema)
    } else if (inputsFor(node).schema !== undefined) {
      // Columns were unresolvable, so any remaining value is malformed. Clearing it keeps
      // the editor inferring columns from its input data, as the legacy runtime did.
      setInput(node.id, 'schema', null)
    }
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
    if (targetHandle?.namespace !== 'par') {
      report(`Could not materialize schema connection ${edge.id}; invalid target handle.`)
      continue
    }
    if (Object.hasOwn(inputsFor(target), targetHandle.fieldName)) continue
    const schema = resolveTableSchema(edge.source)
    if (schema) {
      setInput(edge.target, targetHandle.fieldName, schema)
    } else {
      report(`Could not materialize schema connection ${edge.id}; the source schema is unresolved.`)
    }
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

// Removed live relationships cannot be reconstructed safely. Materialized values remain valid in v20.
export async function down(project: NoodlesProjectJSON): Promise<NoodlesProjectJSON> {
  return project
}
