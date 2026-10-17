import type { Edge, Node } from '@xyflow/react'
import type { OperatorRegistry, ProjectModification } from './types'
import { ProjectModificationSchema } from './types'

export interface ProjectSnapshot {
  nodes: Node<Record<string, unknown>>[]
  edges: Edge[]
}

export interface ModificationProposal {
  id: string
  modifications: ProjectModification[]
  summary: {
    addedNodes: number
    updatedNodes: number
    deletedNodes: number
    addedEdges: number
    deletedEdges: number
  }
  nextSnapshot: ProjectSnapshot
  warnings: string[]
}

export type ProposalValidationResult =
  | { success: true; proposal: ModificationProposal }
  | { success: false; errors: string[] }

export function resolveModificationProposal(
  proposal: ModificationProposal,
  decision: 'accept' | 'reject'
): ProjectSnapshot | null {
  return decision === 'accept' ? structuredClone(proposal.nextSnapshot) : null
}

export function validateProjectModifications(
  snapshot: ProjectSnapshot,
  input: unknown,
  registry: OperatorRegistry
): ProposalValidationResult {
  if (!Array.isArray(input) || input.length === 0) {
    return { success: false, errors: ['modifications must be a non-empty array'] }
  }

  const parsed: ProjectModification[] = []
  const errors: string[] = []
  for (const [index, value] of input.entries()) {
    const result = ProjectModificationSchema.safeParse(value)
    if (!result.success) {
      errors.push(
        `Modification ${index + 1}: ${result.error.issues[0]?.message ?? 'invalid shape'}`
      )
    } else {
      parsed.push(result.data)
    }
  }
  if (errors.length > 0) return { success: false, errors }

  const nodes = new Map(snapshot.nodes.map(node => [node.id, structuredClone(node)]))
  const edges = new Map(snapshot.edges.map(edge => [edge.id, { ...edge }]))
  const originalOutCount = [...nodes.values()].filter(node => node.type === 'OutOp').length

  for (const mod of parsed) {
    switch (mod.type) {
      case 'add_node': {
        const node = mod.data as Node<Record<string, unknown>>
        if (!validNodeId(node.id))
          errors.push(`Invalid node id "${node.id}"; ids must start with /`)
        if (nodes.has(node.id)) errors.push(`Node id already exists: ${node.id}`)
        validateNode(node, registry, errors)
        if (!nodes.has(node.id)) {
          const normalized = {
            ...node,
            position: node.position ?? { x: 0, y: 0 },
            data: node.data ?? {},
          }
          Object.assign(mod.data, normalized)
          nodes.set(node.id, structuredClone(normalized))
        }
        break
      }
      case 'update_node': {
        const current = nodes.get(mod.data.id)
        if (!current) {
          errors.push(`Cannot update missing node: ${mod.data.id}`)
          break
        }
        const next = mergeNode(current, mod.data as never)
        validateNode(next, registry, errors)
        nodes.set(next.id, next)
        break
      }
      case 'delete_node':
        if (!nodes.has(mod.data.id)) errors.push(`Cannot delete missing node: ${mod.data.id}`)
        nodes.delete(mod.data.id)
        for (const [id, edge] of edges) {
          if (edge.source === mod.data.id || edge.target === mod.data.id) edges.delete(id)
        }
        break
      case 'add_edge':
        if (edges.has(mod.data.id)) errors.push(`Edge id already exists: ${mod.data.id}`)
        edges.set(mod.data.id, { ...mod.data })
        break
      case 'delete_edge':
        if (!edges.has(mod.data.id)) errors.push(`Cannot delete missing edge: ${mod.data.id}`)
        edges.delete(mod.data.id)
        break
    }
  }

  if (originalOutCount > 0 && [...nodes.values()].every(node => node.type !== 'OutOp')) {
    errors.push('Cannot delete the last Output node')
  }

  validateEdges(nodes, edges, registry, errors)
  if (hasCycle(nodes, edges)) errors.push('The proposed edges create a cycle')
  if (errors.length > 0) return { success: false, errors: [...new Set(errors)] }

  const modifications = parsed.map(mod => structuredClone(mod))
  return {
    success: true,
    proposal: {
      id: `proposal-${stableHash(JSON.stringify(modifications))}`,
      modifications,
      summary: summarize(modifications),
      nextSnapshot: { nodes: [...nodes.values()], edges: [...edges.values()] },
      warnings: [],
    },
  }
}

function validateNode(
  node: Node<Record<string, unknown>>,
  registry: OperatorRegistry,
  errors: string[]
) {
  if (!node.type || !registry.operators[node.type]) {
    errors.push(`Unknown operator type for ${node.id}: ${node.type ?? '(missing)'}`)
    return
  }
  const inputs = asRecord(asRecord(node.data).inputs)
  const schema = registry.operators[node.type]
  for (const [name, value] of Object.entries(inputs)) {
    const field = schema.inputs[name]
    if (!field) errors.push(`Unknown input ${node.id}.par.${name}`)
    else if (!valueMatchesField(value, field.type)) {
      errors.push(`Invalid value for ${node.id}.par.${name}; expected ${field.type}`)
    }
  }
}

function validateEdges(
  nodes: Map<string, Node<Record<string, unknown>>>,
  edges: Map<string, Edge>,
  registry: OperatorRegistry,
  errors: string[]
) {
  const connections = new Set<string>()
  const targets = new Set<string>()
  for (const edge of edges.values()) {
    const source = nodes.get(edge.source)
    const target = nodes.get(edge.target)
    if (!source || !target) {
      errors.push(`Edge ${edge.id} references a missing node`)
      continue
    }
    const sourceName = fieldName(edge.sourceHandle, 'out')
    const targetName = fieldName(edge.targetHandle, 'par')
    if (!sourceName || !targetName) {
      errors.push(`Edge ${edge.id} must connect an out.* handle to a par.* handle`)
      continue
    }
    const sourceField = registry.operators[source.type ?? '']?.outputs[sourceName]
    const targetField = registry.operators[target.type ?? '']?.inputs[targetName]
    if (!sourceField) errors.push(`Unknown source handle ${edge.source}.${edge.sourceHandle}`)
    if (!targetField) errors.push(`Unknown target handle ${edge.target}.${edge.targetHandle}`)
    if (sourceField && targetField && !fieldTypesCompatible(sourceField.type, targetField.type)) {
      errors.push(
        `Incompatible edge ${edge.id}: ${sourceField.type} cannot connect to ${targetField.type}`
      )
    }
    const signature = `${edge.source}|${edge.sourceHandle}|${edge.target}|${edge.targetHandle}`
    if (connections.has(signature)) errors.push(`Duplicate edge connection: ${edge.id}`)
    connections.add(signature)
    const targetSignature = `${edge.target}|${edge.targetHandle}`
    if (targets.has(targetSignature) && targetField?.type !== 'ListField') {
      errors.push(`Multiple edges target single input ${edge.target}.${edge.targetHandle}`)
    }
    targets.add(targetSignature)
  }
}

function hasCycle(nodes: Map<string, Node<Record<string, unknown>>>, edges: Map<string, Edge>) {
  const outgoing = new Map<string, string[]>()
  for (const id of nodes.keys()) outgoing.set(id, [])
  for (const edge of edges.values()) outgoing.get(edge.source)?.push(edge.target)
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true
    if (visited.has(id)) return false
    visiting.add(id)
    for (const target of outgoing.get(id) ?? []) if (visit(target)) return true
    visiting.delete(id)
    visited.add(id)
    return false
  }
  return [...nodes.keys()].some(visit)
}

function fieldTypesCompatible(source: string, target: string) {
  if (source === target) return true
  if (source === 'UnknownField' || target === 'UnknownField') return true
  if (source === 'DataField' || target === 'DataField' || target === 'ListField') return true
  const sourceFamily = fieldFamily(source)
  const targetFamily = fieldFamily(target)
  return !sourceFamily || !targetFamily || sourceFamily === targetFamily
}

function fieldFamily(type: string) {
  for (const family of ['Number', 'Boolean', 'String', 'Color', 'Point', 'Layer']) {
    if (type.includes(family)) return family
  }
  return null
}

function valueMatchesField(value: unknown, fieldType: string) {
  if (value === undefined || value === null) return true
  if (fieldType.includes('Expression')) {
    return ['string', 'number', 'boolean'].includes(typeof value)
  }
  if (fieldType.includes('Number')) return typeof value === 'number' && Number.isFinite(value)
  if (fieldType.includes('Boolean')) return typeof value === 'boolean'
  if (fieldType.includes('String') || fieldType.includes('Code')) return typeof value === 'string'
  if (fieldType.includes('List') || fieldType.includes('Array')) return Array.isArray(value)
  if (fieldType.includes('Color')) return typeof value === 'string' || Array.isArray(value)
  if (fieldType.includes('Point') || fieldType.includes('Vec')) {
    return Array.isArray(value) || (typeof value === 'object' && value !== null)
  }
  return true
}

function fieldName(handle: string | null | undefined, prefix: 'out' | 'par') {
  return handle?.startsWith(`${prefix}.`) ? handle.slice(prefix.length + 1) || null : null
}

function validNodeId(id: string) {
  return id.startsWith('/') && id.length > 1 && !id.includes('//')
}

function mergeNode(
  node: Node<Record<string, unknown>>,
  update: Partial<Node<Record<string, unknown>>> & { id: string }
): Node<Record<string, unknown>> {
  const nodeData = asRecord(node.data)
  const updateData = asRecord(update.data)
  return {
    ...node,
    ...update,
    data: {
      ...nodeData,
      ...updateData,
      inputs: { ...asRecord(nodeData.inputs), ...asRecord(updateData.inputs) },
    },
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function summarize(modifications: ProjectModification[]) {
  return {
    addedNodes: modifications.filter(mod => mod.type === 'add_node').length,
    updatedNodes: modifications.filter(mod => mod.type === 'update_node').length,
    deletedNodes: modifications.filter(mod => mod.type === 'delete_node').length,
    addedEdges: modifications.filter(mod => mod.type === 'add_edge').length,
    deletedEdges: modifications.filter(mod => mod.type === 'delete_edge').length,
  }
}

function stableHash(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}
