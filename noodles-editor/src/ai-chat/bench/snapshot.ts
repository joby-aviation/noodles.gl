// What the agent bench records of a document for grading, kept apart from the page hook so the
// task tests can build the same snapshot in Node.

import { type EditorDoc, OPERATORS } from '@noodles.gl/planner'

// Large values (inline data, long code) are elided; no check needs them
const MAX_VALUE_CHARS = 2000

// Every node's parameters with its operator's defaults filled in: the document stores only what
// was set
export function paramsOf(doc: EditorDoc): Record<string, Record<string, unknown>> {
  const snapshot: Record<string, Record<string, unknown>> = {}
  for (const node of doc.nodes) {
    const op = OPERATORS.find(o => o.type === node.op)
    const params: Record<string, unknown> = {}
    for (const def of op?.params ?? []) params[def.name] = def.default
    for (const [name, value] of Object.entries({ ...params, ...node.params })) {
      const json = JSON.stringify(value)
      params[name] = json && json.length > MAX_VALUE_CHARS ? '[elided]' : value
    }
    snapshot[node.id] = params
  }
  return snapshot
}

// Operator type -> its ports and parameters. Inputs include a parameter's `par:` port.
export function registryOf(): Record<
  string,
  { inputs: string[]; outputs: string[]; params: string[] }
> {
  const snapshot: Record<string, { inputs: string[]; outputs: string[]; params: string[] }> = {}
  for (const op of OPERATORS) {
    snapshot[op.type] = {
      inputs: [
        ...op.inputs.map(p => p.name),
        ...op.params.filter(p => p.port).map(p => `par:${p.name}`),
      ],
      outputs: op.outputs.map(p => p.name),
      params: op.params.map(p => p.name),
    }
  }
  return snapshot
}
