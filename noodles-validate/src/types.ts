// The shape of registry.json: the editor's operator catalog, written by
// noodles-editor/src/editor/operator-registry-snapshot.test.ts.

export type PortType = 'table' | 'layer' | 'number' | 'value' | 'any'

export interface PortInfo {
  type: PortType
  // Takes several edges, in order: a deck's layers, a union's inputs
  multi?: boolean
  optional?: boolean
}

export interface ParamInfo {
  // float, int, toggle, menu, string, text, expr, code, column, color, url, field
  kind: string
  default?: unknown
  // A default JSON cannot hold (Infinity), as JS text
  defaultText?: string
  // A menu's values
  options?: string[]
  // What a `par:<name>` edge into it takes; a number when absent
  portType?: PortType
}

export interface OperatorInfo {
  // Display name, e.g. "Scatter Layer" for scatter
  name: string
  type: string
  category?: string
  description?: string
  inputs: Record<string, PortInfo>
  outputs: Record<string, PortInfo>
  params: Record<string, ParamInfo>
}

export interface Registry {
  // The document version a current project file declares
  documentVersion: number
  // Operator-graph files (version 2 to this) convert to documents when they open
  convertsFrom: number
  // Categories in the Add Node menu's order
  categories?: string[]
  operators: Record<string, OperatorInfo>
  // Operator classes of older files and the operators they convert to
  formerly?: Record<string, string[]>
}

export type Severity = 'error' | 'warning'

export type Rule =
  | 'unreadable-file'
  | 'invalid-json'
  | 'project-shape'
  | 'version'
  | 'operator-graph'
  | 'node-id'
  | 'duplicate-node-id'
  | 'unknown-operator'
  | 'unknown-parent'
  | 'duplicate-name'
  | 'unknown-param'
  | 'param-value'
  | 'unknown-reference'
  | 'generic-node-name'
  | 'edge-shape'
  | 'edge-unknown-node'
  | 'edge-port'
  | 'edge-type'
  | 'edge-network'
  | 'duplicate-edge'
  | 'duplicate-edge-id'
  | 'multiple-inputs'
  | 'cycle'
  | 'timeline-target'

export interface Diagnostic {
  severity: Severity
  rule: Rule
  // Where in the file, e.g. "nodes[3]" or "edges[0]"
  at: string
  // The node or edge id, when there is one
  id?: string
  message: string
}

export interface ValidationResult {
  valid: boolean
  errors: Diagnostic[]
  warnings: Diagnostic[]
}
