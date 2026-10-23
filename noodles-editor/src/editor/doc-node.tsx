// A document node in the network editor, compact as Houdini's are: a header colored by
// category, its table and layer ports, and parameter ports only while they are wired or a
// wire that could drive one is being dragged. Badges say what the planner made of it: a
// memoized table or an inlined query, the rows it drew, the engines it ran on. Parameters are
// edited in the parameter pane, not on the node.

import {
  canConnect,
  nameOf,
  OPERATOR_INDEX,
  type PortSpec,
  type PortType,
} from '@noodles.gl/planner'
import { Handle, type NodeProps, Position, useConnection } from '@xyflow/react'
import cx from 'classnames'
import { useMemo } from 'react'
import { headerClass } from '../noodles/components/op-components'
import ns from '../noodles/noodles.module.css'
import { type EngineState, useEngineState } from './doc-engine'
import s from './doc-network.module.css'
import { useEditor } from './doc-store'

const CATEGORY_HEADERS: Record<string, string | undefined> = {
  data: ns.headerData,
  table: ns.headerUtility,
  geometry: ns.headerGeojson ?? ns.headerUtility,
  rows: ns.headerCode,
  color: ns.headerColor,
  layer: ns.headerLayer,
  output: ns.headerView,
  number: ns.headerNumber,
  structure: ns.headerGrouping,
}

/** A node's header color: its Noodles operator's, or its category's. */
export function headerOf(type: string): string | undefined {
  const op = OPERATOR_INDEX.get(type)
  return op?.category === 'host' ? headerClass(type as never) : CATEGORY_HEADERS[op?.category ?? '']
}

/** Port colors, by what flows: rows, a layer, a number, any other value, or anything. */
export const PORT_CLASS: Record<string, string | undefined> = {
  table: s.portTable,
  layer: s.portLayer,
  number: s.portNumber,
  value: s.portValue,
  any: s.portAny,
}

const count = (n: number | undefined): string => {
  if (n === undefined) return '?'
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n)
}

interface Badge {
  text: string
  kind: 'memo' | 'rows' | 'sql' | 'cpu' | 'gpu'
  title?: string
}

/** What the planner made of a node, and the first thing that stopped it. */
export function nodeStatus(id: string, engine: EngineState): { badges: Badge[]; error?: string } {
  const lowered = engine.lowered
  const program = engine.program
  const irIds = lowered?.irNodes[id] ?? []
  const out = lowered?.outputs[id]?.out ?? irIds[irIds.length - 1]
  const badges: Badge[] = []
  const engines = new Set<string>()
  let error = engine.errors.find(e => e.nodeId === id)?.message
  for (const ir of irIds) {
    const info = program?.nodes[ir]
    if (!info) continue
    for (const e of Object.values(info.engines)) engines.add(e)
    error ??= info.error
  }
  const rel = program?.relations.find(r => r.id === out)
  if (rel) {
    badges.push({
      text: rel.materialize ? `table · ${count(rel.rows)}` : 'inline',
      kind: 'memo',
      title: `${rel.materialize ? `memoized as ${rel.table}` : 'inlined into its reader'}\n${rel.sql}`,
    })
  }
  for (const e of engines) {
    if (e === 'sql' || e === 'cpu' || e === 'gpu') badges.push({ text: e.toUpperCase(), kind: e })
  }
  const layer = engine.layers.find(l => l.id === id)
  if (layer) {
    badges.push({
      text: `${count(layer.rows)} drawn`,
      kind: 'rows',
      title: `query ${layer.queryMs.toFixed(1)} ms · cpu ${layer.evalMs.toFixed(1)} ms`,
    })
    error ??= layer.error
  }
  return { badges, error }
}

/** The type a dragged wire carries, from the handle it started at. */
function draggedType(
  handle: string | undefined,
  nodeOp: string | undefined,
  side: 'source' | 'target' | undefined
): PortType | 'param' | undefined {
  if (!handle || !nodeOp) return undefined
  if (handle.startsWith('par:')) return 'param'
  const def = OPERATOR_INDEX.get(nodeOp)
  return (side === 'source' ? def?.outputs : def?.inputs)?.find(p => p.name === handle)?.type
}

function PortRow({ port, side, dim }: { port: PortSpec; side: 'in' | 'out'; dim: boolean }) {
  return (
    <div className={cx(s.port, side === 'out' && s.portOut)}>
      <Handle
        id={port.name}
        type={side === 'in' ? 'target' : 'source'}
        position={side === 'in' ? Position.Left : Position.Right}
        className={cx(PORT_CLASS[port.type], dim && s.dim)}
      />
      {side === 'out'
        ? port.type === 'table'
          ? 'rows'
          : port.name === 'out'
            ? port.type
            : port.name
        : `${port.label ?? port.name}${port.multi ? ' …' : ''}`}
    </div>
  )
}

export function DocNodeComponent({ id, selected }: NodeProps) {
  const node = useEditor(st => st.doc.nodes.find(n => n.id === id))
  const edges = useEditor(st => st.doc.edges)
  const nodeOps = useEditor(st => st.doc.nodes)
  const engine = useEngineState()
  const connection = useConnection()
  const wired = useMemo(
    () => new Set(edges.filter(e => e.target === id).map(e => e.targetPort)),
    [edges, id]
  )
  if (!node) return null
  const op = OPERATOR_INDEX.get(node.op)
  if (!op) {
    return (
      <div className={cx(s.node, s.nodeError)}>
        <div className={cx(s.header, ns.headerData)}>
          <span className={s.name}>{nameOf(node)}</span>
          <span className={s.type}>unknown operator {node.op}</span>
        </div>
      </div>
    )
  }
  const { badges, error } = nodeStatus(id, engine)

  // While a wire is dragged from an output, the inputs it fits stay lit and the rest dim; the
  // parameter ports it could drive appear
  const fromNode = connection.inProgress
    ? nodeOps.find(n => n.id === connection.fromNode?.id)
    : undefined
  const dragging = connection.inProgress
    ? draggedType(connection.fromHandle?.id ?? undefined, fromNode?.op, connection.fromHandle?.type)
    : undefined
  const fromOut = connection.fromHandle?.type === 'source'
  const fits = (t: PortType | 'param') =>
    !dragging || dragging === 'param'
      ? false
      : t === 'param'
        ? dragging === 'number'
        : canConnect(dragging as PortType, t)
  const dimIn = (t: PortType) => !!dragging && fromOut && !fits(t)
  const dimOut = (t: PortType) =>
    !!dragging &&
    !fromOut &&
    !(dragging === 'param' ? t === 'number' : canConnect(t, dragging as PortType))
  const params = op.params.filter(
    p =>
      p.port &&
      (wired.has(`par:${p.name}`) ||
        (dragging && fromOut && canConnect(dragging as PortType, p.portType ?? 'number')))
  )
  const header = headerOf(node.op)

  return (
    <div
      className={cx(s.node, {
        [s.selected]: selected,
        [s.nodeError]: !!error,
        [s.bypassed]: node.flags?.bypass,
        [s.displayed]: node.flags?.display,
      })}
      title={error ?? op.description}
    >
      <div className={cx(s.header, header)}>
        <span className={s.name}>{nameOf(node)}</span>
        <span className={s.type}>{op.label}</span>
      </div>
      {/* Where reference edges (ch(), ref values) attach: no wire is ever drawn to them */}
      <Handle
        id="ref-in"
        type="target"
        position={Position.Left}
        isConnectable={false}
        className={s.refHandle}
      />
      <Handle
        id="ref-out"
        type="source"
        position={Position.Right}
        isConnectable={false}
        className={s.refHandle}
      />
      <div className={s.body}>
        {op.inputs.map(p => (
          <PortRow key={`in-${p.name}`} port={p} side="in" dim={dimIn(p.type)} />
        ))}
        {params.map(p => (
          <div className={cx(s.port, s.paramPort)} key={`par-${p.name}`}>
            <Handle
              id={`par:${p.name}`}
              type="target"
              position={Position.Left}
              className={cx(
                PORT_CLASS[p.portType ?? 'number'],
                s.paramHandle,
                dragging && !wired.has(`par:${p.name}`) && !fits(p.portType ?? 'number') && s.dim
              )}
            />
            {p.label}
          </div>
        ))}
        {op.outputs.map(p => (
          <PortRow key={`out-${p.name}`} port={p} side="out" dim={dimOut(p.type)} />
        ))}
        {badges.length > 0 && (
          <div className={s.badges}>
            {badges.map(b => (
              <span key={b.text} className={cx(s.badge, s[`badge_${b.kind}`])} title={b.title}>
                {b.text}
              </span>
            ))}
          </div>
        )}
        {error && <div className={s.error}>{error}</div>}
      </div>
    </div>
  )
}
