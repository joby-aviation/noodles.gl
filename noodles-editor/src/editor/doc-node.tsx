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
import { categories } from '../noodles/components/categories'
import { ColorSwatch } from '../noodles/components/color-swatch'
import ns from '../noodles/noodles.module.css'
import { type EngineState, useEngineState } from './doc-engine'
import s from './doc-network.module.css'
import { isListParam, setParam } from './doc-ops'
import { docStore, useEditor } from './doc-store'
import { colorToFieldHex, fieldHexToColor } from './field-adapter'
import { useNodeLinkTarget } from './link-drag'
import { pillHeight } from './multi-port'
import { MultiPortHandle } from './multi-port-handle'
import { shownValue, summaryOf } from './node-summary'
import { canLink } from './param-links'
import { useUIStore } from './ui-store'

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

// A host operator's header: the color of the Add Node category its Noodles operator is in
const NOODLES_HEADERS: Record<string, string | undefined> = {
  code: ns.headerCode,
  color: ns.headerColor,
  data: ns.headerData,
  effect: ns.headerEffect,
  extension: ns.headerExtension,
  geojson: ns.headerGeojson,
  grouping: ns.headerGrouping,
  layer: ns.headerLayer,
  number: ns.headerNumber,
  string: ns.headerString,
  utility: ns.headerUtility,
  vector: ns.headerVector,
  view: ns.headerView,
  widget: ns.headerWidget,
}

function noodlesHeader(type: string): string | undefined {
  const name = type.replace(/Op$/, '')
  const found = Object.entries(categories).find(([, names]) =>
    (names as readonly string[]).includes(name)
  )
  return NOODLES_HEADERS[found?.[0] ?? 'data']
}

/** A node's header color: its Noodles operator's, or its category's. */
export function headerOf(type: string): string | undefined {
  const op = OPERATOR_INDEX.get(type)
  return op?.category === 'host' ? noodlesHeader(type) : CATEGORY_HEADERS[op?.category ?? '']
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

/** What the info card says about a node: what it is, what it made, what went wrong. */
function infoLines(id: string, engine: EngineState): string[] {
  const lines: string[] = []
  const layer = engine.layers.find(l => l.id === id)
  if (layer) {
    lines.push(
      `${layer.rows.toLocaleString()} drawn${layer.paths ? ` in ${layer.paths.toLocaleString()} paths` : ''}`
    )
    lines.push(`query ${layer.queryMs.toFixed(1)} ms · cpu pass ${layer.evalMs.toFixed(1)} ms`)
  }
  const irIds = engine.lowered?.irNodes[id] ?? []
  const out = engine.lowered?.outputs[id]?.out ?? irIds[irIds.length - 1]
  const rel = engine.program?.relations.find(r => r.id === out)
  if (rel?.rows !== undefined) lines.push(`${rel.rows.toLocaleString()} rows`)
  if (rel) lines.push(`columns: ${rel.shape.columns.map(c => c.name).join(', ')}`)
  return lines
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

function PortRow({
  nodeId,
  port,
  side,
  dim,
}: {
  nodeId: string
  port: PortSpec
  side: 'in' | 'out'
  dim: boolean
}) {
  const multi = side === 'in' && !!port.multi
  // A multi input's row grows with its pill, so a long pill doesn't run into the next row
  const wires = useEditor(st =>
    multi ? st.doc.edges.filter(e => e.target === nodeId && e.targetPort === port.name).length : 0
  )
  const className = cx(PORT_CLASS[port.type], dim && s.dim)
  return (
    <div
      className={cx(s.port, side === 'out' && s.portOut)}
      style={multi ? { height: Math.max(18, pillHeight(wires) + 4) } : undefined}
    >
      {multi ? (
        <MultiPortHandle port={port.name} className={className} />
      ) : (
        <Handle
          id={port.name}
          type={side === 'in' ? 'target' : 'source'}
          position={side === 'in' ? Position.Left : Position.Right}
          className={className}
        />
      )}
      {side === 'out'
        ? port.type === 'table'
          ? 'rows'
          : port.name === 'out'
            ? port.type
            : port.name
        : (port.label ?? port.name)}
    </div>
  )
}

export function DocNodeComponent({ id, selected }: NodeProps) {
  const node = useEditor(st => st.doc.nodes.find(n => n.id === id))
  const edges = useEditor(st => st.doc.edges)
  const nodeOps = useEditor(st => st.doc.nodes)
  const engine = useEngineState()
  const debug = useEditor(st => st.debug)
  const connection = useConnection()
  // A property's port dropped on the node: a picker of what on it fits, as a layer stack row's
  const linkTarget = useNodeLinkTarget(id, { spring: false })
  // A Properties port being dragged (link-drag.tsx), so the parameter handles it fits appear
  const linkDrag = useUIStore(st => st.linkDrag)
  const doc = useEditor(st => st.doc)
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
  const status = nodeStatus(id, engine)
  const error = status.error
  // How the planner stored and ran a node is for debug mode; what it drew is in the info card
  const badges = debug ? status.badges : []
  const summary = summaryOf(node, op)
  const info = infoLines(id, engine)
  const swatch = node.op === 'color' ? op.params.find(p => p.kind === 'color') : undefined
  const swatchValue = swatch ? (node.params[swatch.name] ?? swatch.default) : undefined

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
        (dragging && fromOut && canConnect(dragging as PortType, p.portType ?? 'number')) ||
        (linkDrag?.kind === 'source' && canLink(doc, linkDrag.key, `${id}.${p.name}`)))
  )
  const header = headerOf(node.op)

  return (
    <div
      className={cx(s.node, {
        [s.selected]: selected,
        [s.nodeError]: !!error,
        [s.bypassed]: node.flags?.bypass,
        [s.displayed]: node.flags?.display,
        [s.linkTarget]: linkTarget.accepts,
      })}
      {...linkTarget.props}
    >
      {linkTarget.picker}
      <div className={cx(s.header, header)}>
        <span className={s.name}>{nameOf(node)}</span>
        <span className={s.type}>{op.label}</span>
        <span className={cx(s.info, 'nodrag')}>
          i
          <span className={s.infoCard} role="tooltip">
            <span className={s.infoTitle}>{op.label}</span>
            <span>{op.description}</span>
            {info.map(l => (
              <span key={l} className={s.infoStat}>
                {l}
              </span>
            ))}
            {error && <span className={s.infoError}>{error}</span>}
          </span>
        </span>
      </div>
      {(summary || swatch) && (
        <div className={s.summary} title={summary}>
          {swatch && swatchValue !== undefined && (
            <span className="nodrag">
              <ColorSwatch
                value={colorToFieldHex(swatchValue)}
                onChange={hex =>
                  docStore().edit(
                    d => setParam(d, id, swatch.name, fieldHexToColor(hex)),
                    `color:${id}`
                  )
                }
              />
            </span>
          )}
          <span className={s.summaryText}>
            {swatch && swatchValue !== undefined
              ? shownValue(colorToFieldHex(swatchValue))
              : summary}
          </span>
        </div>
      )}
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
          <PortRow key={`in-${p.name}`} nodeId={id} port={p} side="in" dim={dimIn(p.type)} />
        ))}
        {params.map(p =>
          // A list parameter takes several wires in order, drawn as a multi input's pill
          isListParam(op.type, p.name) ? (
            <PortRow
              key={`par-${p.name}`}
              nodeId={id}
              port={{
                name: `par:${p.name}`,
                type: p.portType ?? 'value',
                label: p.label,
                multi: true,
              }}
              side="in"
              dim={!!dragging && !wired.has(`par:${p.name}`) && !fits(p.portType ?? 'value')}
            />
          ) : (
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
          )
        )}
        {op.outputs.map(p => (
          <PortRow key={`out-${p.name}`} nodeId={id} port={p} side="out" dim={dimOut(p.type)} />
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
