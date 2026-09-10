import type { Subscription } from 'rxjs'
import { type Field, getFieldReferences, isSerializedExpression } from './fields'
import { type Edge as ExecutorEdge, updateGraph } from './graph-executor'
import type { IOperator, Operator } from './operators'
import type { GraphNode } from './utils/for-loop-group-utils'
import { edgeId } from './utils/id-utils'
import { parseHandleId } from './utils/path-utils'

export type ReferenceEdge = ExecutorEdge & {
  type: 'ReferenceEdge'
  selectable: false
  deletable: false
  focusable: false
  reconnectable: false
}

export type ReferenceNode = GraphNode & {
  data?: { inputs?: Record<string, unknown> }
}

type BoundReference = {
  edge: ReferenceEdge
  targetField: Field
}

type ConfigureOptions = {
  nodes: ReferenceNode[]
  /**
   * Non-reference edges used by the executor. This deliberately accepts more
   * than persisted React Flow edges so structural dependencies (for example,
   * container output bridges) remain intact when a live reference changes.
   */
  executionEdges: ExecutorEdge[]
  operators: Operator<IOperator>[]
}

function serializedValueToReferenceText(value: unknown): string | null {
  if (isSerializedExpression(value)) return value.$expr
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    const strings = value.filter((item): item is string => typeof item === 'string')
    return strings.length > 0 ? strings.join('\n') : null
  }
  return null
}

function fieldReferenceText(field: Field): string | null {
  return field.expression ?? serializedValueToReferenceText(field.value)
}

function connectionKey(
  edge: Pick<ExecutorEdge, 'source' | 'sourceHandle' | 'target' | 'targetHandle'>
) {
  return `${edge.source}.${edge.sourceHandle}->${edge.target}.${edge.targetHandle}`
}

function relationKey(edge: Pick<ExecutorEdge, 'source' | 'target'>) {
  return `${edge.source}->${edge.target}`
}

function isPullDependency(edge: Pick<ExecutorEdge, 'source' | 'sourceHandle' | 'target'>) {
  const source = parseHandleId(edge.sourceHandle)
  return !(
    source?.namespace === 'par' &&
    (edge.source === edge.target || edge.target.startsWith(`${edge.source}/`))
  )
}

/** Derive ephemeral reference edges from serialized node input values. */
export function deriveReferenceEdges(
  nodes: ReadonlyArray<ReferenceNode>,
  existingEdges: ReadonlyArray<
    Pick<ExecutorEdge, 'source' | 'sourceHandle' | 'target' | 'targetHandle'>
  >
): ReferenceEdge[] {
  const nodeIds = new Set(nodes.map(node => node.id))
  const seen = new Set(existingEdges.map(connectionKey))
  const derived: ReferenceEdge[] = []

  for (const node of nodes) {
    for (const [fieldName, value] of Object.entries(node.data?.inputs ?? {})) {
      const text = serializedValueToReferenceText(value)
      if (!text || !(text.includes('op(') || text.includes('{{'))) continue

      for (const ref of getFieldReferences(text, node.id)) {
        if (!nodeIds.has(ref.opId)) continue
        const connection = {
          source: ref.opId,
          sourceHandle: ref.handleId,
          target: node.id,
          targetHandle: `par.${fieldName}`,
        }
        const key = connectionKey(connection)
        if (seen.has(key)) continue
        seen.add(key)
        derived.push({
          id: edgeId(connection),
          type: 'ReferenceEdge',
          selectable: false,
          deletable: false,
          focusable: false,
          reconnectable: false,
          ...connection,
        })
      }
    }
  }

  return derived
}

/**
 * Owns the complete lifecycle of reactive `op()` / mustache dependencies.
 * React components subscribe only to its edge snapshot for visualization.
 */
class ReferenceDependencyModel {
  private nodes: ReferenceNode[] = []
  private executionEdges: ExecutorEdge[] = []
  private operators = new Map<string, Operator<IOperator>>()
  private edges: ReferenceEdge[] = []
  private boundReferences = new Map<string, BoundReference>()
  private ownedRelations = new Map<
    string,
    { sourceOp: Operator<IOperator>; targetOp: Operator<IOperator> }
  >()
  private fieldWatchers: Subscription[] = []
  private fieldTexts = new Map<Field, string | null>()
  private listeners = new Set<() => void>()
  private refreshing = false

  getSnapshot = (): ReferenceEdge[] => this.edges

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  configure({ nodes, executionEdges, operators }: ConfigureOptions): ReferenceEdge[] {
    this.clearFieldWatchers()
    this.nodes = nodes
    this.executionEdges = executionEdges.filter(
      edge => (edge as ExecutorEdge & { type?: string }).type !== 'ReferenceEdge'
    )
    this.operators = new Map(operators.map(op => [op.id, op]))

    const nextEdges = this.deriveFromFields()
    this.replaceEdges(nextEdges, false)
    this.watchInputFields()
    updateGraph(this.nodes, [...this.executionEdges, ...this.edges])
    return this.edges
  }

  reset(): void {
    this.clearFieldWatchers()
    for (const bound of this.boundReferences.values()) {
      bound.targetField.removeConnection(bound.edge.id, 'reference')
    }
    this.boundReferences.clear()
    const executionRelations = new Set(
      this.executionEdges.filter(isPullDependency).map(edge => relationKey(edge))
    )
    for (const [relation, { sourceOp, targetOp }] of this.ownedRelations) {
      if (executionRelations.has(relation)) continue
      sourceOp.removeDownstreamDependent(targetOp)
      targetOp.removeUpstreamDependency(sourceOp)
    }
    this.ownedRelations.clear()
    this.nodes = []
    this.executionEdges = []
    this.operators.clear()
    this.publish([])
  }

  private deriveFromFields(): ReferenceEdge[] {
    const nodeIds = new Set(this.nodes.map(node => node.id))
    const seen = new Set(this.executionEdges.map(connectionKey))
    const result: ReferenceEdge[] = []

    for (const node of this.nodes) {
      const op = this.operators.get(node.id)
      if (!op) continue

      for (const [fieldName, field] of Object.entries(op.inputs)) {
        const text = fieldReferenceText(field)
        if (!text || !(text.includes('op(') || text.includes('{{'))) continue

        for (const ref of getFieldReferences(text, node.id)) {
          if (!nodeIds.has(ref.opId)) continue
          const connection = {
            source: ref.opId,
            sourceHandle: ref.handleId,
            target: node.id,
            targetHandle: `par.${fieldName}`,
          }
          const key = connectionKey(connection)
          if (seen.has(key)) continue
          seen.add(key)
          result.push({
            id: edgeId(connection),
            type: 'ReferenceEdge',
            selectable: false,
            deletable: false,
            focusable: false,
            reconnectable: false,
            ...connection,
          })
        }
      }
    }

    return result
  }

  private watchInputFields(): void {
    for (const op of this.operators.values()) {
      for (const field of Object.values(op.inputs)) {
        this.fieldTexts.set(field, fieldReferenceText(field))
        const refreshIfSourceChanged = () => {
          if (this.refreshing) return

          const text = fieldReferenceText(field)
          if (text === this.fieldTexts.get(field)) return
          this.fieldTexts.set(field, text)
          this.refresh()
        }
        this.fieldWatchers.push(field.subscribe(refreshIfSourceChanged))
        this.fieldWatchers.push(field.expression$.subscribe(refreshIfSourceChanged))
      }
    }
  }

  private refresh(): void {
    this.refreshing = true
    try {
      const nextEdges = this.deriveFromFields()
      if (this.hasSameEdges(nextEdges)) return
      this.replaceEdges(nextEdges, true)
      updateGraph(this.nodes, [...this.executionEdges, ...this.edges])
    } finally {
      this.refreshing = false
    }
  }

  private replaceEdges(nextEdges: ReferenceEdge[], markTargetsDirty: boolean): void {
    const oldRelations = new Set(this.edges.filter(isPullDependency).map(edge => relationKey(edge)))
    const nextRelations = new Set(nextEdges.filter(isPullDependency).map(edge => relationKey(edge)))
    const executionRelations = new Set(
      this.executionEdges.filter(isPullDependency).map(edge => relationKey(edge))
    )

    for (const bound of this.boundReferences.values()) {
      bound.targetField.removeConnection(bound.edge.id, 'reference')
    }
    this.boundReferences.clear()

    for (const relation of oldRelations) {
      const owned = this.ownedRelations.get(relation)
      const separator = relation.indexOf('->')
      const currentSource = this.operators.get(relation.slice(0, separator))
      const currentTarget = this.operators.get(relation.slice(separator + 2))
      const sameOperators = owned?.sourceOp === currentSource && owned?.targetOp === currentTarget
      const relationStillExists = nextRelations.has(relation) || executionRelations.has(relation)
      if (owned && (!relationStillExists || !sameOperators)) {
        const { sourceOp, targetOp } = owned
        sourceOp.removeDownstreamDependent(targetOp)
        targetOp.removeUpstreamDependency(sourceOp)
      }
      this.ownedRelations.delete(relation)
    }

    for (const edge of nextEdges) {
      const sourceOp = this.operators.get(edge.source)
      const targetOp = this.operators.get(edge.target)
      const sourceHandle = parseHandleId(edge.sourceHandle)
      const targetHandle = parseHandleId(edge.targetHandle)
      if (!sourceOp || !targetOp || !sourceHandle || !targetHandle) continue

      const sourceField =
        sourceOp[sourceHandle.namespace === 'par' ? 'inputs' : 'outputs'][sourceHandle.fieldName]
      const targetField =
        targetOp[targetHandle.namespace === 'par' ? 'inputs' : 'outputs'][targetHandle.fieldName]
      if (!sourceField || !targetField) continue

      // A field already invalidates its own operator; subscribing it to itself
      // would recursively emit forever.
      if (sourceField !== targetField) {
        targetField.addConnection(edge.id, sourceField, 'reference')
        this.boundReferences.set(edge.id, { edge, targetField })
      }

      if (isPullDependency(edge)) {
        sourceOp.addDownstreamDependent(targetOp)
        targetOp.addUpstreamDependency(sourceOp)
        this.ownedRelations.set(relationKey(edge), { sourceOp, targetOp })
      }
    }

    if (markTargetsDirty) {
      const oldIds = new Set(this.edges.map(edge => edge.id))
      const nextIds = new Set(nextEdges.map(edge => edge.id))
      for (const edge of [...this.edges, ...nextEdges]) {
        if (oldIds.has(edge.id) === nextIds.has(edge.id)) continue
        this.operators.get(edge.target)?.markDirty()
      }
    }

    this.publish(nextEdges)
  }

  private hasSameEdges(nextEdges: ReferenceEdge[]): boolean {
    if (nextEdges.length !== this.edges.length) return false
    const ids = new Set(this.edges.map(edge => edge.id))
    return nextEdges.every(edge => ids.has(edge.id))
  }

  private publish(edges: ReferenceEdge[]): void {
    if (this.hasSameEdges(edges)) return
    this.edges = edges
    for (const listener of this.listeners) listener()
  }

  private clearFieldWatchers(): void {
    for (const watcher of this.fieldWatchers) watcher.unsubscribe()
    this.fieldWatchers = []
    this.fieldTexts.clear()
  }
}

export const referenceDependencyModel = new ReferenceDependencyModel()
