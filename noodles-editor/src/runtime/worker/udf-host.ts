// A graph's JS functions, registered with DuckDB before the graph compiles. Each component of
// each function is one DuckDB function, named by a hash of its body, so registering is once
// per body per database and a changed body is a new name.

import { type UdfRegistration, type UdfSpec, udfRegistrations } from '@noodles.gl/planner'
import type { BlockingSql } from './blocking-sql'

/** What a UDF body can use besides its parameters: Math and the other JS built-ins. */
function compile(reg: UdfRegistration): (...args: unknown[]) => unknown {
  // A UDF is code the document's author wrote, run in the engine worker
  return new Function(...reg.params.map(p => p.name), reg.body) as (...args: unknown[]) => unknown
}

export class UdfHost {
  private readonly registered = new Set<string>()

  constructor(private readonly sql: BlockingSql) {}

  /** Register what a graph calls that DuckDB does not have yet. */
  register(udfs: Record<string, UdfSpec> | undefined): void {
    for (const reg of udfRegistrations(udfs)) {
      if (this.registered.has(reg.sqlName)) continue
      const fn = compile(reg)
      const { component, width } = reg
      this.sql.createNumberFunction(reg.sqlName, (...args) => {
        // A throw or a non-number is NaN for that row, as a failed accessor was skipped
        try {
          const value = fn(...args)
          const n = Number(
            width === 1 ? value : (value as ArrayLike<unknown> | undefined)?.[component]
          )
          return Number.isFinite(n) ? n : Number.NaN
        } catch {
          return Number.NaN
        }
      })
      this.registered.add(reg.sqlName)
    }
  }
}
