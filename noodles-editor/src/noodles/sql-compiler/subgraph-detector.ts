import type { IOperator, Operator } from '../operators'
import type { CompilableNode } from './compiler'
import { collectSubgraph, compile } from './compiler'
import { collectParamValues, PreparedPipeline } from './executor'
import { templateRegistry } from './templates'
import type { CompiledQuery, ExecutionResult } from './types'

// FileOp with @/ URLs can't be compiled — DuckDB can't access browser virtual filesystems.
// FileOp with text/binary format can't be compiled — DuckDB only handles structured data.
function isIncompatibleFileOp(op: Operator<IOperator>): boolean {
  const url = op.inputs?.url?.value
  if (typeof url === 'string' && url.startsWith('@/')) return true
  const format = op.inputs?.format?.value
  if (format === 'text' || format === 'binary') return true
  return false
}

// Adapt a real Operator to the CompilableNode interface the compiler expects
export function adaptOperator(
  op: Operator<IOperator>,
  getUpstreamIds: (opId: string) => string[]
): CompilableNode | undefined {
  const opType = (op.constructor as { displayName?: string }).displayName
  if (!opType || !templateRegistry.has(opType)) return undefined
  if (isIncompatibleFileOp(op)) return undefined

  return {
    id: op.id,
    type: opType,
    inputs: op.inputs as Record<string, { value: unknown }>,
    getUpstreamDataIds: () => getUpstreamIds(op.id),
  }
}

// Detect and compile SQL-compilable subgraphs from a set of operators.
// Returns compiled pipelines ready for execution.
export function detectCompilableSubgraphs(
  sinkIds: string[],
  getOperator: (id: string) => Operator<IOperator> | undefined,
  getUpstreamIds: (opId: string) => string[]
): Map<string, CompiledQuery> {
  const compiledPipelines = new Map<string, CompiledQuery>()

  for (const sinkId of sinkIds) {
    const sinkOp = getOperator(sinkId)
    if (!sinkOp) continue

    // Check if this sink directly consumes from a compilable subgraph
    const upstreamIds = getUpstreamIds(sinkId)
    for (const upstreamId of upstreamIds) {
      // Try to collect a subgraph from each upstream
      const subgraph = collectSubgraph(upstreamId, id => {
        const op = getOperator(id)
        if (!op) return undefined
        return adaptOperator(op, getUpstreamIds)
      })

      if (subgraph.length > 0) {
        try {
          const compiled = compile(subgraph)
          compiledPipelines.set(upstreamId, compiled)
        } catch (e) {
          // Compilation failed — fall back to normal execution
          console.warn(`[sql-compiler] Failed to compile subgraph from ${upstreamId}:`, e)
        }
      }
    }
  }

  return compiledPipelines
}

// Resolve parameter values from a compiled query using live operator field values
export function resolveParamValues(
  compiled: CompiledQuery,
  getOperator: (id: string) => Operator<IOperator> | undefined
): unknown[] {
  return collectParamValues(compiled.paramSlots, (fieldPath, slot) => {
    // If the slot has a direct value (e.g., from IN clause extraParams), use it
    if (slot?.value !== undefined) {
      return slot.value
    }
    // fieldPath format: "/opId.fieldName"
    const dotIdx = fieldPath.indexOf('.')
    if (dotIdx === -1) return undefined
    const opId = fieldPath.substring(0, dotIdx)
    const fieldName = fieldPath.substring(dotIdx + 1)
    const op = getOperator(opId)
    if (!op) return undefined
    const field = op.inputs[fieldName]
    return field?.value
  })
}

// Cache for compiled pipelines — invalidated on topology changes
export class SQLExecutionCache {
  private pipelines = new Map<string, PreparedPipeline>()
  private compiledQueries = new Map<string, CompiledQuery>()

  invalidate() {
    this.topologyVersion++
    for (const pipeline of this.pipelines.values()) {
      pipeline.close().catch(() => {})
    }
    this.pipelines.clear()
    this.compiledQueries.clear()
  }

  getCompiledQuery(sinkId: string): CompiledQuery | undefined {
    return this.compiledQueries.get(sinkId)
  }

  setCompiledQuery(sinkId: string, compiled: CompiledQuery): void {
    this.compiledQueries.set(sinkId, compiled)
  }

  async getOrCreatePipeline(sinkId: string, compiled: CompiledQuery): Promise<PreparedPipeline> {
    let pipeline = this.pipelines.get(sinkId)
    if (!pipeline) {
      pipeline = new PreparedPipeline(compiled)
      await pipeline.prepare()
      this.pipelines.set(sinkId, pipeline)
    }
    return pipeline
  }

  async executeCompiled(
    sinkId: string,
    compiled: CompiledQuery,
    paramValues: unknown[]
  ): Promise<ExecutionResult> {
    const pipeline = await this.getOrCreatePipeline(sinkId, compiled)
    return pipeline.execute(paramValues)
  }
}
