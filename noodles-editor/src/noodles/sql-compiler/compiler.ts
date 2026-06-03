import type { Operator } from '../operators'
import {
  type CompilationContext,
  type CompiledPipeline,
  type ParamRef,
  type SQLFragment,
  type UDFDef,
  isSQLCompilable,
} from './types'
import { operatorIdToAlias } from './utils'

export function createCompilationContext(): CompilationContext {
  const aliases = new Map<string, string>()
  const params: ParamRef[] = []
  const udfs: UDFDef[] = []
  let paramCounter = 0

  return {
    aliases,
    params,
    udfs,
    nextParamIndex() {
      return ++paramCounter
    },
    getUpstreamAlias(operatorId: string) {
      return aliases.get(operatorId) ?? null
    },
  }
}

// Walk backward from a sink operator, collecting all SQL-compilable ancestors
// in topological order. Stops at non-compilable operators (JS boundary).
export function collectSQLSubgraph(
  sink: Operator<any>,
  getOperator: (id: string) => Operator<any> | undefined
): Operator<any>[] {
  const visited = new Set<string>()
  const sorted: Operator<any>[] = []

  function visit(op: Operator<any>) {
    if (visited.has(op.id)) return
    visited.add(op.id)

    if (!isSQLCompilable(op)) return

    // Visit upstream dependencies first (topological order)
    for (const dep of (op as any)._upstreamDependencies) {
      visit(dep)
    }

    sorted.push(op)
  }

  visit(sink)
  return sorted
}

// Compile a subgraph of SQL-compilable operators into a single SQL statement
export function compilePipeline(
  operators: Operator<any>[],
  ctx?: CompilationContext
): CompiledPipeline {
  const context = ctx ?? createCompilationContext()
  const ctes: string[] = []
  let lastAlias = ''

  for (const op of operators) {
    if (!isSQLCompilable(op)) continue

    const alias = operatorIdToAlias(op.id)
    context.aliases.set(op.id, alias)

    const fragment: SQLFragment = (op as any).toSQL(context)
    ctes.push(`${fragment.alias} AS (\n    ${fragment.cte}\n  )`)
    lastAlias = fragment.alias

    for (const param of fragment.params) {
      context.params.push(param)
    }
    for (const udf of fragment.udfs) {
      if (!context.udfs.some(u => u.name === udf.name)) {
        context.udfs.push(udf)
      }
    }
  }

  const sql = ctes.length > 0
    ? `WITH\n  ${ctes.join(',\n  ')}\nSELECT * FROM ${lastAlias}`
    : `SELECT 1`

  return {
    sql,
    params: context.params,
    udfs: context.udfs,
    sinkAlias: lastAlias,
  }
}
