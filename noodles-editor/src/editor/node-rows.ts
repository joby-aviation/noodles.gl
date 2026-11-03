// The rows at a node, for the spreadsheet: a planner node's rows from the engine (its
// relation, or the row-wise chain lowered to SQL), a host operator's first output as it is.
// Read again whenever the engine reports an update.

import { nameOf, OPERATOR_INDEX } from '@noodles.gl/planner'
import { useEffect, useState } from 'react'
import { currentEngine, useEngineState } from './doc-engine'
import { useEditor } from './doc-store'

export interface NodeRows {
  /** The node's display name. */
  name?: string
  data?: unknown
  /** Rows in all, when only a sample was read. */
  total?: number
  note?: string
  error?: string
}

/** How many rows the spreadsheet reads; it virtualizes, but the read is a query. */
const LIMIT = 5000

export function useNodeRows(nodeId: string | null): NodeRows {
  const node = useEditor(s => (nodeId ? s.doc.nodes.find(n => n.id === nodeId) : undefined))
  const { vis } = useEngineState()
  const [rows, setRows] = useState<NodeRows>({})

  // biome-ignore lint/correctness/useExhaustiveDependencies: vis changes on every engine update, which is when the rows may have changed
  useEffect(() => {
    if (!nodeId) {
      setRows({})
      return
    }
    if (!node) {
      setRows({ error: 'Node not found' })
      return
    }
    const name = nameOf(node)
    const op = OPERATOR_INDEX.get(node.op)
    const engine = currentEngine()
    if (!op || !engine) {
      setRows({ name, error: engine ? `Unknown operator ${node.op}` : 'The engine is starting' })
      return
    }
    if (op.outputs.length === 0) {
      setRows({ name, error: 'No outputs available' })
      return
    }
    if (op.category === 'host') {
      setRows({ name, data: engine.hostOutput(node.id, op.outputs[0].name) })
      return
    }
    const lowered = engine.lowering()
    const ir = lowered?.outputs[node.id]?.[op.outputs[0].name] ?? lowered?.irNodes[node.id]?.at(-1)
    if (!ir) {
      const reason = lowered?.errors.find(e => e.nodeId === node.id)?.message
      setRows({ name, error: reason ?? 'This node has no rows' })
      return
    }
    let cancelled = false
    void engine.runtime
      .preview(ir, LIMIT)
      .then(p => {
        if (!cancelled) setRows({ name, data: p.rows, total: p.total, note: p.note })
      })
      .catch(error => {
        if (!cancelled) setRows({ name, error: (error as Error).message })
      })
    return () => {
      cancelled = true
    }
  }, [nodeId, node, vis])

  return rows
}
