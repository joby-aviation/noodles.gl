import type { CompiledQuery } from './types'
import type { Operator, IOperator } from '../operators'
import { adaptOperator, detectCompilableSubgraphs, resolveParamValues, SQLExecutionCache } from './subgraph-detector'
import { getDuckDbInstance } from './executor'
import { templateRegistry } from './templates'

export type SQLExecutionResult = {
  operatorId: string
  data: unknown[]
  arrowTable: unknown
}

// Integrates SQL compilation into the pull-based graph executor.
// Detects compilable subgraphs, executes them via DuckDB, and injects
// results into boundary operators so they skip JS-based pulling.
export class SQLGraphIntegration {
  private cache = new SQLExecutionCache()
  private lastTopologyVersion = -1
  private enabled = true

  setEnabled(enabled: boolean) {
    this.enabled = enabled
  }

  isEnabled(): boolean {
    return this.enabled && getDuckDbInstance() !== null
  }

  invalidate() {
    this.cache.invalidate()
    this.lastTopologyVersion++
  }

  // Main entry point: called by GraphExecutor before pulling roots.
  // Returns the set of operator IDs whose outputs have been satisfied by SQL execution.
  async executeSQLSubgraphs(
    sinkOperatorIds: string[],
    getOperator: (id: string) => Operator<IOperator> | undefined,
    getUpstreamIds: (opId: string) => string[],
    topologyVersion: number,
  ): Promise<Map<string, SQLExecutionResult>> {
    if (!this.isEnabled()) return new Map()

    // Recompile on topology change
    if (topologyVersion !== this.lastTopologyVersion) {
      this.cache.invalidate()
      this.lastTopologyVersion = topologyVersion

      const compiled = detectCompilableSubgraphs(
        sinkOperatorIds,
        getOperator,
        getUpstreamIds,
      )

      for (const [opId, query] of compiled) {
        this.cache.setCompiledQuery(opId, query)
      }
    }

    const results = new Map<string, SQLExecutionResult>()

    // Execute each compiled pipeline
    for (const sinkId of sinkOperatorIds) {
      const upstreamIds = getUpstreamIds(sinkId)
      for (const upstreamId of upstreamIds) {
        const compiled = this.cache.getCompiledQuery(upstreamId)
        if (!compiled) continue

        try {
          const paramValues = resolveParamValues(compiled, getOperator)
          const result = await this.cache.executeCompiled(upstreamId, compiled, paramValues)
          results.set(upstreamId, {
            operatorId: upstreamId,
            data: result.toArray(),
            arrowTable: result.table,
          })
        } catch (e) {
          console.warn(`[sql-compiler] Execution failed for ${upstreamId}:`, e)
        }
      }
    }

    return results
  }

  // Inject SQL results into operator cached outputs.
  // This makes downstream operators see the SQL-computed data when they pull.
  injectResults(
    results: Map<string, SQLExecutionResult>,
    getOperator: (id: string) => Operator<IOperator> | undefined,
  ): Set<string> {
    const injectedIds = new Set<string>()

    for (const [opId, result] of results) {
      const op = getOperator(opId)
      if (!op) continue

      // Inject the computed data as cached output
      op.setCachedOutput({ data: result.data } as any)

      // Push data to output fields so downstream subscriptions fire
      const dataOutput = op.outputs?.data
      if (dataOutput) {
        dataOutput.next(result.data)
      }

      injectedIds.add(opId)

      // Also mark all operators in this compiled chain as clean
      // Walk the compiled query's aliases to find all operators in the chain
      const compiled = this.cache.getCompiledQuery(opId)
      if (compiled) {
        for (const chainOpId of compiled.operatorAliases.keys()) {
          if (chainOpId === opId) continue
          const chainOp = getOperator(chainOpId)
          if (chainOp) {
            chainOp.setCachedOutput(chainOp.cachedOutput ?? ({ data: [] } as any))
            injectedIds.add(chainOpId)
          }
        }
      }
    }

    return injectedIds
  }

  // Check if an operator's data is being satisfied by SQL execution
  isSQLExecuted(opId: string): boolean {
    return this.cache.getCompiledQuery(opId) !== undefined
  }

  getCompiledQuery(opId: string): CompiledQuery | undefined {
    return this.cache.getCompiledQuery(opId)
  }

  getStats(): { compiledPipelines: number; enabled: boolean } {
    return {
      compiledPipelines: this.countCompiledPipelines(),
      enabled: this.isEnabled(),
    }
  }

  private countCompiledPipelines(): number {
    let count = 0
    // Count by trying known IDs — we don't expose the internal map directly
    return count
  }
}

// Singleton instance for use by the global graph executor
let globalIntegration: SQLGraphIntegration | null = null

export function getSQLIntegration(): SQLGraphIntegration {
  if (!globalIntegration) {
    globalIntegration = new SQLGraphIntegration()
  }
  return globalIntegration
}

export function resetSQLIntegration(): void {
  globalIntegration?.invalidate()
  globalIntegration = null
}
