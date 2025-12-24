// Type definitions for Claude AI integration

export interface Manifest {
  version: string
  generated: string
  commit: string
  bundles: {
    codeIndex: BundleInfo
    operatorRegistry: BundleInfo
    docsIndex: BundleInfo
    examples: BundleInfo
  }
}

export interface BundleInfo {
  file: string
  size: number
  hash: string
}

export interface CodeIndex {
  version: string
  files: Record<string, FileIndex>
}

export interface FileIndex {
  path: string
  fullText: string
  lines: string[]
  hash: string
  lastModified: string
  symbols: Symbol[]
  imports: Import[]
  exports: Export[]
}

export interface Symbol {
  name: string
  type: 'class' | 'function' | 'interface' | 'type' | 'const' | 'enum'
  line: number
  endLine: number
  docstring?: string
  signature?: string
}

export interface Import {
  module: string
  imports: string[]
  line: number
}

export interface Export {
  name: string
  type: string
  line: number
}

export interface OperatorRegistry {
  version: string
  operators: Record<string, OperatorSchema>
  categories: Record<string, string[]>
}

export interface OperatorSchema {
  name: string
  type: string
  category: 'data' | 'layer' | 'renderer' | 'accessor' | 'utility' | 'container'
  description: string
  docstring?: string
  inputs: Record<string, FieldSchema>
  outputs: Record<string, FieldSchema>
  sourceFile: string
  sourceLine: number
}

export interface FieldSchema {
  name: string
  type: string
  description?: string
  required: boolean
  defaultValue?: unknown
}

export interface DocsIndex {
  version: string
  topics: Record<string, DocTopic>
}

export interface DocTopic {
  id: string
  title: string
  section: 'users' | 'developers' | 'intro' | 'ai-assistant' | 'examples'
  file: string
  content: string
  headings: Heading[]
  codeExamples: CodeExample[]
  relatedTopics: string[]
}

export interface Heading {
  level: number
  text: string
  anchor: string
}

export interface CodeExample {
  language: string
  code: string
  description?: string
}

export interface ExamplesIndex {
  version: string
  examples: Record<string, Example>
}

export interface Example {
  id: string
  name: string
  description: string
  category: string
  project: unknown // NoodlesProject - keeping as unknown since it's serialized JSON
  annotations: Record<string, NodeAnnotation>
  tags: string[]
  dataSourceTypes: string[]
  layerTypes: string[]
  techniques: string[]
}

export interface NodeAnnotation {
  nodeId: string
  description: string
  purpose: string
  configurationNotes?: string
}

export interface LoadProgress {
  stage: 'manifest' | 'code' | 'operators' | 'docs' | 'examples' | 'complete'
  loaded: number
  total: number
  bytesLoaded: number
  bytesTotal: number
}

export interface ToolResult {
  success: boolean
  data?: unknown
  error?: string
}

export interface SearchCodeParams {
  pattern: string
  path?: string
  contextLines?: number
  maxResults?: number
}

export interface SearchCodeResult {
  file: string
  line: number
  endLine?: number
  context: string[]
  symbol?: string
}

export interface Message {
  role: 'user' | 'assistant'
  content: string | Array<{ type: string; text?: string; [key: string]: unknown }>
}

export interface ClaudeResponse {
  message: string
  projectModifications?: ProjectModification[]
  toolCalls?: ToolCall[]
}

export interface ProjectModification {
  type: 'add_node' | 'update_node' | 'delete_node' | 'add_edge' | 'delete_edge'
  data: unknown
}

export interface ToolCall {
  name: string
  params: Record<string, unknown>
  result: ToolResult
}

export interface ConsoleError {
  level: 'error' | 'warn'
  message: string
  filename?: string
  lineno?: number
  colno?: number
  stack?: string
  timestamp: number
}

// Basic project structure with nodes and edges
export interface NoodlesProject {
  nodes?: Array<{
    id: string
    type: string
    position?: { x: number; y: number }
    data?: Record<string, unknown>
    [key: string]: unknown
  }>
  edges?: Array<{
    id: string
    source: string
    target: string
    sourceHandle?: string
    targetHandle?: string
    [key: string]: unknown
  }>
  [key: string]: unknown
}
