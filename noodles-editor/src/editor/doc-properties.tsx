// The parameter pane: the selected node's parameters and nothing else, laid out from its
// operator's schema as d-d-d's pane is: folders as tabs, a Noodles widget per parameter, what
// a change costs on each row. Below them, what the planner made of the node: its relation and
// SQL, its layer's numbers, which of its parameters animate.

import {
  type DocNode,
  type EditorDoc,
  nameOf,
  nodePath,
  OPERATOR_INDEX,
  type OpDef,
} from '@noodles.gl/planner'
import cx from 'classnames'
import { useEffect, useState } from 'react'
import s from './doc-editor.module.css'
import { type EngineState, useEngineState } from './doc-engine'
import { headerOf } from './doc-node'
import { renameNode, unpromote } from './doc-ops'
import { docStore, useEditor } from './doc-store'
import { ParamRow, shown, useNodeFields } from './param-row'

const NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/

export function DocProperties() {
  const selection = useEditor(st => st.selection)
  const doc = useEditor(st => st.doc)
  const node = selection.length > 0 ? doc.nodes.find(n => n.id === selection[0]) : undefined
  if (!node) return <DocumentInfo doc={doc} />
  return <NodeParams key={node.id} node={node} doc={doc} multi={selection.length > 1} />
}

function DocumentInfo({ doc }: { doc: EditorDoc }) {
  return (
    <div className={s.pane}>
      <div className={s.paneHead}>
        <div className={s.paneRow}>
          <span className={s.chip} style={{ background: 'var(--node-view-color)' }}>
            project
          </span>
          <input
            className={s.paneName}
            aria-label="Project name"
            value={doc.name}
            onChange={e => {
              const name = e.target.value
              docStore().edit(d => {
                d.name = name
              }, 'doc-name')
            }}
          />
        </div>
      </div>
      <div className={s.empty}>
        Select a node to edit its parameters. <kbd>Tab</kbd> in the network adds an operator; drag
        from a port to wire it, and right-click a wire to insert a node. Right-click a parameter for
        expressions, references, keyframes and promotion.
      </div>
    </div>
  )
}

function NodeParams({ node, doc, multi }: { node: DocNode; doc: EditorDoc; multi: boolean }) {
  const op = OPERATOR_INDEX.get(node.op)
  const engine = useEngineState()
  const fields = useNodeFields(node)
  const [folder, setFolder] = useState<string>()
  const [name, setName] = useState(nameOf(node))
  useEffect(() => setName(nameOf(node)), [node])
  if (!op) return <div className={s.empty}>Unknown operator {node.op}</div>

  const visible = op.params.filter(p => shown(p, node, op))
  const folders = [...new Set(visible.map(p => p.folder ?? 'Parameters'))]
  const current = folder && folders.includes(folder) ? folder : folders[0]
  const wired = new Set(doc.edges.filter(e => e.target === node.id).map(e => e.targetPort))
  const errors = errorsFor(node.id, engine)

  const commitName = () => {
    const next = name.trim()
    if (next === nameOf(node)) return
    const taken = doc.nodes.some(
      n => n.id !== node.id && n.parent === node.parent && nameOf(n) === next
    )
    if (!NAME.test(next) || taken) {
      setName(nameOf(node))
      return
    }
    docStore().edit(d => {
      renameNode(d, node.id, next)
    })
  }
  const flag = (f: 'bypass' | 'display') =>
    docStore().edit(d => {
      const n = d.nodes.find(x => x.id === node.id)
      if (n) n.flags = { ...n.flags, [f]: !n.flags?.[f] }
    })

  return (
    <div className={s.pane}>
      <div className={s.paneHead}>
        <div className={s.paneRow}>
          <span className={cx(s.chip, headerOf(node.op))}>{op.label}</span>
          <input
            className={s.paneName}
            aria-label="Node name"
            value={name}
            onChange={e => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={e => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') setName(nameOf(node))
            }}
          />
          <div className={s.flags}>
            <button
              type="button"
              className={cx(s.flag, node.flags?.bypass && s.flagBypass)}
              title="Bypass (B)"
              onClick={() => flag('bypass')}
            >
              B
            </button>
            <button
              type="button"
              className={cx(s.flag, node.flags?.display && s.flagDisplay)}
              title="Display: preview its rows as points (D)"
              onClick={() => flag('display')}
            >
              D
            </button>
          </div>
        </div>
        <div className={s.panePath}>
          {nodePath(doc, node)}
          {multi ? '  · first of the selection' : ''}
        </div>
        {op.description && <div className={s.paneDesc}>{op.description}</div>}
      </div>
      {errors.map(e => (
        <div className={s.error} key={e}>
          {e}
        </div>
      ))}
      {folders.length > 1 && (
        <div className={s.folders} role="tablist">
          {folders.map(f => (
            <button
              type="button"
              role="tab"
              key={f}
              aria-selected={f === current}
              onClick={() => setFolder(f)}
            >
              {f}
            </button>
          ))}
        </div>
      )}
      <div className={s.params}>
        {fields &&
          visible
            .filter(p => (p.folder ?? 'Parameters') === current)
            .map(def => {
              const b = fields.bindings.get(def.name)
              return b ? (
                <ParamRow
                  key={def.name}
                  node={node}
                  def={def}
                  field={b.field}
                  wired={wired.has(`par:${def.name}`)}
                />
              ) : null
            })}
        {node.op === 'subnet' && <Promoted subnet={node} doc={doc} />}
      </div>
      <NodeInfo node={node} op={op} engine={engine} />
    </div>
  )
}

function errorsFor(id: string, engine: EngineState): string[] {
  const irIds = engine.lowered?.irNodes[id] ?? []
  return [
    ...engine.errors.filter(e => e.nodeId === id).map(e => e.message),
    ...irIds.map(ir => engine.program?.nodes[ir]?.error).filter((e): e is string => !!e),
    ...engine.layers.filter(l => l.id === id && l.error).map(l => l.error as string),
  ].filter((e, i, all) => all.indexOf(e) === i)
}

/** A subnet's promoted parameters: each edits the child parameter it drives. */
function Promoted({ subnet, doc }: { subnet: DocNode; doc: EditorDoc }) {
  const promoted = subnet.promoted ?? []
  if (promoted.length === 0) {
    return (
      <div className={s.empty}>
        No promoted parameters. Inside the subnet, right-click a parameter and choose Promote to
        subnet.
      </div>
    )
  }
  return (
    <>
      {promoted.map(pp => {
        const child = doc.nodes.find(n => n.id === pp.node)
        return child ? (
          <PromotedRow
            key={pp.name}
            child={child}
            param={pp.param}
            label={pp.label ?? pp.name}
            onUnpromote={() => docStore().edit(d => unpromote(d, subnet.id, pp.name))}
          />
        ) : null
      })}
    </>
  )
}

function PromotedRow({
  child,
  param,
  label,
  onUnpromote,
}: {
  child: DocNode
  param: string
  label: string
  onUnpromote: () => void
}) {
  const fields = useNodeFields(child)
  const def = OPERATOR_INDEX.get(child.op)?.params.find(p => p.name === param)
  const b = fields?.bindings.get(param)
  if (!def || !b) return null
  return (
    <ParamRow
      node={child}
      def={def}
      field={b.field}
      wired={false}
      label={label}
      onUnpromote={onUnpromote}
    />
  )
}

/** What the planner did with the node: its relation, its layer, its animated parameters. */
function NodeInfo({ node, op, engine }: { node: DocNode; op: OpDef; engine: EngineState }) {
  const timeline = useEditor(st => st.doc.timeline)
  const irIds = engine.lowered?.irNodes[node.id] ?? []
  const out = engine.lowered?.outputs[node.id]?.out ?? irIds[irIds.length - 1]
  const rel = engine.program?.relations.find(r => r.id === out)
  const layer = engine.layers.find(l => l.id === node.id)
  const animated = op.params.filter(p =>
    timeline?.tracks.some(t => t.target === `${node.id}.${p.name}`)
  )
  return (
    <>
      {rel && (
        <div className={s.section}>
          <h4>Relation</h4>
          <dl className={s.kv}>
            <dt>memo</dt>
            <dd>{rel.materialize ? `temp table ${rel.table}` : 'inlined into its reader'}</dd>
            <dt>rows</dt>
            <dd>{rel.rows?.toLocaleString() ?? '—'}</dd>
            <dt>columns</dt>
            <dd>{rel.shape.columns.map(c => c.name).join(', ')}</dd>
            {rel.params.length > 0 && (
              <>
                <dt>inlines</dt>
                <dd>{rel.params.join(', ')}</dd>
              </>
            )}
          </dl>
          <pre className={s.code}>{rel.sql}</pre>
        </div>
      )}
      {layer && (
        <div className={s.section}>
          <h4>Layer</h4>
          <dl className={s.kv}>
            <dt>instances</dt>
            <dd>
              {layer.rows.toLocaleString()}
              {layer.paths ? ` in ${layer.paths.toLocaleString()} paths` : ''}
            </dd>
            <dt>query</dt>
            <dd>{layer.queryMs.toFixed(1)} ms</dd>
            <dt>cpu stage</dt>
            <dd>{layer.evalMs.toFixed(1)} ms</dd>
            <dt>bindings</dt>
            <dd>{layer.bindings.map(b => `${b.channel}←${b.attribute}`).join(', ')}</dd>
          </dl>
          {layer.sql && <pre className={s.code}>{layer.sql}</pre>}
        </div>
      )}
      {animated.length > 0 && (
        <div className={s.section}>
          <h4>Animation</h4>
          <dl className={s.kv}>
            <dt>keyframed</dt>
            <dd>{animated.map(p => p.label).join(', ')}</dd>
          </dl>
        </div>
      )}
    </>
  )
}
