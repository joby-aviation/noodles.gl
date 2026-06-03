import { FilterOp, FileOp, SliceOp, SortOp } from '../operators'
import type { CompilationContext, SQLFragment } from './types'
import { fileOpToSQL, filterOpToSQL, sliceOpToSQL, sortOpToSQL } from './sql-operators'

function getFirstUpstreamId(op: any): string {
  const deps: Set<any> = op._upstreamDependencies
  if (deps?.size > 0) return deps.values().next().value.id
  return ''
}

// Augment existing operators with toSQL() at runtime.
// TypeScript type safety is provided by the isSQLCompilable() guard in types.ts.

;(FileOp.prototype as any).toSQL = function (this: InstanceType<typeof FileOp>, ctx: CompilationContext): SQLFragment {
  return fileOpToSQL(this.id, {
    url: this.inputs.url.value as string,
    format: this.inputs.format.value as string,
  }, ctx)
}

;(FilterOp.prototype as any).toSQL = function (this: InstanceType<typeof FilterOp>, ctx: CompilationContext): SQLFragment {
  const upstreamId = getFirstUpstreamId(this)
  return filterOpToSQL(this.id, {
    columnName: this.inputs.columnName.value as string,
    condition: this.inputs.condition.value as string,
    value: this.inputs.value.value as string,
  }, upstreamId, ctx)
}

;(SortOp.prototype as any).toSQL = function (this: InstanceType<typeof SortOp>, ctx: CompilationContext): SQLFragment {
  const upstreamId = getFirstUpstreamId(this)
  return sortOpToSQL(this.id, {
    key: this.inputs.key.value as string,
    order: this.inputs.order.value as 'asc' | 'desc',
  }, upstreamId, ctx)
}

;(SliceOp.prototype as any).toSQL = function (this: InstanceType<typeof SliceOp>, ctx: CompilationContext): SQLFragment {
  const upstreamId = getFirstUpstreamId(this)
  return sliceOpToSQL(this.id, {
    start: this.inputs.start.value as number,
    end: this.inputs.end.value as number | undefined,
  }, upstreamId, ctx)
}
