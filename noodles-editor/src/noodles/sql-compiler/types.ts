import type * as arrow from 'apache-arrow'
import type { LayerAttributeSpec } from './layer-attribute-detector'

// A SQL template declares how an operator type maps to SQL.
// Templates use named holes that the compiler resolves.
export interface SQLTemplate {
  // SQL body with template holes: {{upstream}}, {{$paramName}}, {{ident:fieldName}}
  sql: string
  // Which inputs are parameters (data values bound at execution time)
  params: ParamDeclaration[]
  // Which inputs are identifiers (column names, escaped but not parameterized)
  identifiers: IdentifierDeclaration[]
  // How many upstream inputs this template expects
  upstreamCount: 1 | 2 | 0
}

export interface ParamDeclaration {
  // Field name on the operator (e.g., 'value', 'url', 'start')
  field: string
  // How to coerce the field value for SQL binding
  type: 'string' | 'number' | 'boolean' | 'json'
}

export interface IdentifierDeclaration {
  // Field name on the operator
  field: string
  // Template hole name (e.g., 'column', 'key')
  hole: string
  // Whether this field contains comma-separated list of columns
  multi?: boolean
}

// A resolved parameter slot in the compiled query
export interface ParamSlot {
  index: number
  fieldPath: string
  type: ParamDeclaration['type']
  value?: unknown
}

// Result of compiling a subgraph
export interface CompiledQuery {
  sql: string
  paramSlots: ParamSlot[]
  // Maps operator ID → CTE alias for error attribution
  operatorAliases: Map<string, string>
  // Layer attributes detected for SQL compilation (optional)
  layerAttributes?: LayerAttributeSpec[]
}

// Result of executing a compiled query
export interface ExecutionResult {
  table: arrow.Table
  toArray(): Record<string, unknown>[]
}

// Context accumulated during compilation
export interface CompilationContext {
  paramSlots: ParamSlot[]
  nextParamIndex: number
  aliases: Map<string, string>
}

// Marker interface: an operator whose type has a registered SQL template.
// The compiler looks up templates by operator constructor name from the registry.
export interface SQLCompilable {
  readonly id: string
}
