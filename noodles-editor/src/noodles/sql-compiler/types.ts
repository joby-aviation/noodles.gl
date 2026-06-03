import type * as arrow from 'apache-arrow'

export interface SQLFragment {
  cte: string
  alias: string
  params: ParamRef[]
  udfs: UDFDef[]
}

export interface ParamRef {
  index: number
  fieldPath: string
  value: unknown
}

export interface UDFDef {
  name: string
  returnType: arrow.DataType
  func: (...args: any[]) => any
}

export interface CompilationContext {
  aliases: Map<string, string>
  params: ParamRef[]
  udfs: UDFDef[]
  nextParamIndex(): number
  getUpstreamAlias(operatorId: string): string | null
}

export interface SQLCompilable {
  toSQL(ctx: CompilationContext): SQLFragment
}

export function isSQLCompilable(op: unknown): op is SQLCompilable {
  return op != null && typeof (op as any).toSQL === 'function'
}

export interface CompiledPipeline {
  sql: string
  params: ParamRef[]
  udfs: UDFDef[]
  sinkAlias: string
}
