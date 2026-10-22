// A document node in the network editor: ports from its operator, a row per parameter with
// the field widget that edits it, and the error that stopped it drawing.

import {
  type DocNode,
  nameOf,
  OPERATOR_INDEX,
  type OpDef,
  type ParamDef,
  type PortSpec,
} from '@noodles.gl/planner'
import { Handle, type NodeProps, Position } from '@xyflow/react'
import cx from 'classnames'
import { useEffect, useMemo, useRef, useState } from 'react'
import { inputComponents } from '../noodles/components/field-components'
import { handleClass, headerClass } from '../noodles/components/op-components'
import type { Field } from '../noodles/fields'
import s from '../noodles/noodles.module.css'
import { useEngineState } from './doc-engine'
import { docStore, useEditor } from './doc-store'
import { NodeFields } from './field-adapter'

const CATEGORY_HEADERS: Record<string, string | undefined> = {
  data: s.headerData,
  table: s.headerUtility,
  rows: s.headerCode,
  color: s.headerColor,
  layer: s.headerLayer,
  output: s.headerView,
  number: s.headerNumber,
  structure: s.headerGrouping,
}

const PORT_HANDLES: Record<string, string | undefined> = {
  table: s.handleData,
  layer: s.handleLayer,
  number: s.handleNumber,
  value: s.handleCompound,
}

/** Whether a parameter shows, given the values its `when` reads. */
export function shown(def: ParamDef, node: DocNode, op: OpDef): boolean {
  if (!def.when) return true
  const ruled = op.params.find(p => p.name === def.when?.param)
  const value = node.params[def.when.param] ?? ruled?.default
  return def.when.is.includes(value as string | number | boolean)
}

/** The node's fields while it is shown, kept in step with its parameters. */
export function useNodeFields(node: DocNode | undefined): NodeFields | undefined {
  const [fields, setFields] = useState<NodeFields>()
  const id = node?.id
  const op = node?.op
  // biome-ignore lint/correctness/useExhaustiveDependencies: fields are rebuilt only for a new node or operator; parameter changes sync below
  useEffect(() => {
    if (!node) return
    const created = new NodeFields(docStore(), node)
    setFields(created)
    return () => created.dispose()
  }, [id, op])
  useEffect(() => {
    if (node && fields) fields.sync(node)
  }, [node, fields])
  return fields
}

function PortRow({ port, side }: { port: PortSpec; side: 'in' | 'out' }) {
  return (
    <div
      className={cx(s.fieldWrapper, 'nokey')}
      style={{ position: 'relative', justifyContent: side === 'out' ? 'flex-end' : undefined }}
    >
      <Handle
        id={port.name}
        type={side === 'in' ? 'target' : 'source'}
        position={side === 'in' ? Position.Left : Position.Right}
        className={PORT_HANDLES[port.type]}
        style={{ transform: side === 'in' ? 'translateX(-17px)' : 'translateX(17px)' }}
      />
      <div className={s.fieldLabel}>{port.label ?? port.name}</div>
    </div>
  )
}

export function ParamRow({
  def,
  field,
  driven,
  wired,
  handle = true,
}: {
  def: ParamDef
  field: Field
  driven?: string
  wired: boolean
  /** Off outside the network editor, where there is no node to hang a handle on. */
  handle?: boolean
}) {
  const { type } = field.constructor as typeof Field
  const Widget = inputComponents[type]
  return (
    <div style={{ position: 'relative' }} title={def.help}>
      {handle && def.port && (
        <Handle
          id={`par:${def.name}`}
          type="target"
          position={Position.Left}
          className={handleClass(field as never)}
          style={{ top: '12.5px', transform: 'translateX(-17px)' }}
        />
      )}
      {wired || driven ? (
        <div className={cx(s.fieldWrapper, 'nokey')}>
          <div className={s.fieldLabel}>{def.label}</div>
          {driven && <div className={s.fieldInput}>{driven}</div>}
        </div>
      ) : (
        Widget && <Widget id={def.name} field={field} disabled={false} />
      )}
    </div>
  )
}

export function DocNodeComponent({ id }: NodeProps) {
  const node = useEditor(s => s.doc.nodes.find(n => n.id === id))
  const edges = useEditor(s => s.doc.edges)
  const { errors } = useEngineState()
  const fields = useNodeFields(node)
  const wired = useMemo(
    () => new Set(edges.filter(e => e.target === id).map(e => e.targetPort)),
    [edges, id]
  )
  const error = errors.find(e => e.nodeId === id)?.message
  const contentRef = useRef<HTMLDivElement>(null)
  if (!node) return null
  const op = OPERATOR_INDEX.get(node.op)
  if (!op) {
    return (
      <div className={cx(s.wrapper, s.wrapperError)}>
        <div className={cx(s.header, s.dragHandle, s.headerData)}>
          <div className={s.headerTitle}>
            {nameOf(node)} (unknown operator {node.op})
          </div>
        </div>
      </div>
    )
  }
  const header =
    op.category === 'host' ? headerClass(node.op as never) : CATEGORY_HEADERS[op.category]
  return (
    <div className={cx(s.wrapper, { [s.wrapperError]: !!error })}>
      <div className={cx(s.header, s.dragHandle, header)} title={error ?? op.description}>
        <div className={s.headerTitle}>
          {nameOf(node)} ({op.label})
        </div>
        {error && (
          <span className={cx(s.executionIndicator, s.executionIndicatorError)}>
            <i className="pi pi-exclamation-triangle" />
          </span>
        )}
      </div>
      <div className={s.content} ref={contentRef}>
        {op.inputs.map(port => (
          <PortRow key={port.name} port={port} side="in" />
        ))}
        {fields &&
          op.params
            .filter(def => shown(def, node, op))
            .map(def => {
              const b = fields.bindings.get(def.name)
              // The body shows what a node is mostly edited by; the properties panel has all.
              const inBody =
                wired.has(`par:${def.name}`) ||
                (op.category === 'host'
                  ? b?.field.showByDefault
                  : !def.folder || def.folder === 'Channels')
              return b && inBody ? (
                <ParamRow
                  key={def.name}
                  def={def}
                  field={b.field}
                  driven={b.driven}
                  wired={wired.has(`par:${def.name}`)}
                />
              ) : null
            })}
        {op.outputs.map(port => (
          <PortRow key={port.name} port={port} side="out" />
        ))}
      </div>
    </div>
  )
}
