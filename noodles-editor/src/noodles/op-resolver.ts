// `op('/path')` in code operators, expressions and run_code: what a node's parameters are
// (`.par.x`) and what it made (`.out.x`). The editor registers how to answer from its
// document and engine; this module only holds the hook, so operators can call it without
// importing the editor.

export interface OpView {
  id: string
  /** The node's parameters by name. Assigning one edits the document. */
  par: Record<string, unknown>
  /** The node's outputs by port name. */
  out: Record<string, unknown>
}

type Resolver = (path: string, contextId?: string) => OpView | undefined

let resolver: Resolver | undefined

export function setOpResolver(fn: Resolver | undefined): void {
  resolver = fn
}

export function resolveOp(path: string, contextId?: string): OpView | undefined {
  return path ? resolver?.(path, contextId) : undefined
}
