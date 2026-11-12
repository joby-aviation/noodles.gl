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
  // Its `par:<name>` port takes several edges, in order: a Switch Value's values
  multi?: boolean
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
  | 'missing-asset'

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
  // Set by validateFile: the rules the file was checked with
  profile?: Profile
  // True when the file is an operator-graph file and only the checks that don't depend on
  // the document format ran (external profile)
  partial?: boolean
}

// examples: the projects bundled in noodles-editor/src/examples, which are documents and are
// held to the style rules. external: any other project folder, e.g.
// projects/<name>/noodles.json with its files in data/
export type Profile = 'examples' | 'external'

export interface ValidateOptions {
  // Defaults to examples, or for validateFile, to the one for where the file is
  profile?: Profile
  // Where validateFile looks for the bundled examples: this checkout's
  // noodles-editor/src/examples unless a caller serves another checkout
  examplesDir?: string
}
