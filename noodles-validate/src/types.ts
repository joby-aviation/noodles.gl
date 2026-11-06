// The shape of registry.json. Structurally compatible with the editor's runtime
// OperatorRegistry (src/ai-chat/types.ts), so the same checks can run on either.

export interface FieldInfo {
  // Field class name, e.g. NumberField, ListField
  type: string
  default?: unknown
  // In place of default when JSON can't hold it, e.g. "[-Infinity,-Infinity,Infinity,Infinity]"
  defaultText?: string
}

export interface OperatorInfo {
  // Display name, e.g. "File" for FileOp
  name: string
  type: string
  category?: string
  description?: string
  inputs: Record<string, FieldInfo>
  outputs: Record<string, FieldInfo>
}

export interface Registry {
  // NOODLES_VERSION: the schema version a current project file declares
  projectVersion: number
  operators: Record<string, OperatorInfo>
  // The type names a node's data.customInputs may use (fieldTypeToClass keys)
  customFieldTypes?: string[]
}

export type Severity = 'error' | 'warning'

export type Rule =
  | 'unreadable-file'
  | 'invalid-json'
  | 'project-shape'
  | 'version'
  | 'node-id'
  | 'duplicate-node-id'
  | 'unknown-operator'
  | 'unknown-input'
  | 'custom-input'
  | 'generic-node-name'
  | 'edge-shape'
  | 'edge-unknown-node'
  | 'edge-handle'
  | 'duplicate-edge'
  | 'duplicate-edge-id'
  | 'multiple-inputs'
  | 'cycle'
  | 'stale-edge-id'
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
  // True when the file is behind the current schema and only the checks that
  // don't depend on it ran (external profile)
  partial?: boolean
}

// examples: the projects bundled in noodles-editor/src/examples, kept current by
// migrate-projects and held to the style rules. external: any other project
// folder, e.g. projects/<name>/noodles.json with its files in data/
export type Profile = 'examples' | 'external'

export interface ValidateOptions {
  // Defaults to examples
  profile?: Profile
}
