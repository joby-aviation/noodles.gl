// Task-specific mechanical checks (Layer 1, frozen at run time). Each module
// under task-checks/ exports customChecks(ctx) for one task id; run.ts
// dispatches by the task frontmatter's `mechanical.custom`. These checks are
// part of the task's taskVersion — changing them is a task change (07 D7).

export interface CheckResult {
  pass: boolean
  detail?: string
}

export interface ProjectJson {
  version?: number
  name?: string
  nodes?: Array<{
    id?: string
    type?: string
    data?: { inputs?: Record<string, unknown> }
    [k: string]: unknown
  }>
  edges?: Array<{
    id?: string
    source?: string
    target?: string
    sourceHandle?: string
    targetHandle?: string
  }>
  timeline?: unknown
  viewport?: unknown
  editorSettings?: unknown
  [k: string]: unknown
}

export interface CheckContext {
  /** parsed final artifact (null if missing/unparseable) */
  after: ProjectJson | null
  /** parsed base project snapshot, for modify tasks (null for authoring tasks) */
  before: ProjectJson | null
  /** the session's final answer text, when a task grades the explanation */
  resultText: string | null
}

export type CustomChecks = (ctx: CheckContext) => Record<string, CheckResult>

// ---- shared helpers ----

export function nodeById(project: ProjectJson, id: string) {
  return project.nodes?.find(n => n.id === id)
}

export function nodesByType(project: ProjectJson, type: string) {
  return (project.nodes ?? []).filter(n => n.type === type)
}

export function edgesInto(project: ProjectJson, target: string, targetHandle?: string) {
  return (project.edges ?? []).filter(
    e => e.target === target && (targetHandle === undefined || e.targetHandle === targetHandle)
  )
}

/** The value effectively feeding an input: the literal in data.inputs, or —
 * when an edge feeds it — the named input of the upstream node. */
export function effectiveInput(
  project: ProjectJson,
  nodeId: string,
  input: string,
  upstreamInput?: string
): { value: unknown; via: 'literal' | 'edge' | 'absent'; sourceId?: string } {
  const incoming = edgesInto(project, nodeId, `par.${input}`)
  if (incoming.length > 0) {
    const sourceId = incoming[0].source
    const source = sourceId ? nodeById(project, sourceId) : undefined
    const key = upstreamInput ?? Object.keys(source?.data?.inputs ?? {})[0]
    return { value: source?.data?.inputs?.[key as string], via: 'edge', sourceId }
  }
  const literal = nodeById(project, nodeId)?.data?.inputs?.[input]
  return literal === undefined ? { value: undefined, via: 'absent' } : { value: literal, via: 'literal' }
}

const RED_HEXES = new Set(['#ff0000', '#f00', '#ff0000ff', 'red'])
export function isRed(value: unknown): boolean {
  if (typeof value === 'string') return RED_HEXES.has(value.toLowerCase())
  if (Array.isArray(value) && value.length >= 3) {
    const [r, g, b] = value as number[]
    return r >= 200 && g <= 60 && b <= 60
  }
  return false
}

/** Deep-equal via canonical JSON (order-stable for objects). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b)
}
function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  return `{${Object.keys(v as object)
    .sort()
    .map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
    .join(',')}}`
}

/** Does any code-ish input value contain an op('<path>') reference that
 * resolves to an existing node id? Returns the first resolving reference. */
export function findResolvingOpReference(project: ProjectJson): { nodeId: string; ref: string } | null {
  const ids = new Set((project.nodes ?? []).map(n => n.id))
  for (const node of project.nodes ?? []) {
    for (const value of Object.values(node.data?.inputs ?? {})) {
      if (typeof value !== 'string') continue
      for (const m of value.matchAll(/op\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        const raw = m[1]
        const candidates = raw.startsWith('/')
          ? [raw]
          : [
              // relative: resolve against the referencing node's container
              `${(node.id ?? '').split('/').slice(0, -1).join('/')}/${raw.replace(/^\.\//, '')}`,
              `/${raw.replace(/^\.\//, '')}`,
            ]
        if (candidates.some(c => ids.has(c))) return { nodeId: node.id ?? '?', ref: m[0] }
      }
    }
  }
  return null
}
