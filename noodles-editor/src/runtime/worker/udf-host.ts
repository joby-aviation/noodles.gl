// A graph's JS functions, registered with DuckDB before the graph compiles. Each component of
// each function is one DuckDB function, named by a hash of its body, so registering is once
// per body per database and a changed body is a new name.

import { type UdfRegistration, type UdfSpec, udfRegistrations } from '@noodles.gl/planner'
import type { BlockingSql } from './blocking-sql'
import { compileWithScope } from './js-scope'

/** A UDF body with its parameters, and the engine's JS scope (d3, turf, utils). */
function compile(reg: UdfRegistration): (...args: unknown[]) => unknown {
  // A UDF is code the document's author wrote, run in the engine worker
  return compileWithScope(
    reg.params.map(p => p.name),
    reg.body
  )
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
          // A shorter array than the width (a 2D position read as 3D) is zero past its end
          const part = width === 1 ? value : (value as ArrayLike<unknown> | undefined)?.[component]
          const n = width > 1 && part === undefined ? 0 : Number(part)
          return Number.isFinite(n) ? n : Number.NaN
        } catch {
          return Number.NaN
        }
      })
      this.registered.add(reg.sqlName)
    }
  }
}
