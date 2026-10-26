// The parameter pane: the selected node's parameters and nothing else, laid out from its
// operator's schema as d-d-d's pane is: folders as tabs, a Noodles widget per parameter. In
// debug mode, what each change costs, and below the parameters what the planner made of the
// node: its relation and SQL, its layer's numbers, which of its parameters animate.

import {
  type DocNode,
  type EditorDoc,
  nameOf,
  nodePath,
  OPERATOR_INDEX,
  type OpDef,
} from '@noodles.gl/planner'
import cx from 'classnames'
import { useEffect, useRef, useState } from 'react'
import { compoundsFor } from './compound-params'
import { ColorGroupRows, UnitsSelect } from './compound-rows'
import s from './doc-editor.module.css'
import { type EngineState, useEngineState } from './doc-engine'
import { headerOf } from './doc-node'
import { renameNode, unpromote } from './doc-ops'
import { docStore, useEditor } from './doc-store'
import { PANE_EDITORS, PaneEditorFor } from './pane-editors'
import { ParamRow, shown, useNodeFields } from './param-row'
import { dismissStarterHint, getUIStore, useUIStore } from './ui-store'

export const STARTER_HINT_TEXT =
  'Change a value to edit the map. Click any node to see its settings.'

const NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/

export function DocProperties() {
  const selection = useEditor(st => st.selection)
  const doc = useEditor(st => st.doc)
  const node = selection.length > 0 ? doc.nodes.find(n => n.id === selection[0]) : undefined
  // The starter hint goes away once the user selects something else
  const starterHintNodeId = useUIStore(st => st.starterHintNodeId)
  const previous = useRef(node?.id)
  useEffect(() => {
    const was = previous.current
    previous.current = node?.id
    if (starterHintNodeId && was === starterHintNodeId && node?.id !== was) {
      getUIStore().setStarterHintNodeId(null)
    }
  }, [node?.id, starterHintNodeId])
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
        from a port to wire it, and right-click a wire to insert a node. <kbd>L</kbd> lays the
        network out. Right-click a parameter for expressions, references, keyframes and promotion.
      </div>
    </div>
  )
}

function NodeParams({ node, doc, multi }: { node: DocNode; doc: EditorDoc; multi: boolean }) {
  const op = OPERATOR_INDEX.get(node.op)
  const engine = useEngineState()
  const fields = useNodeFields(node)
  const showStarterHint = useUIStore(st => st.starterHintNodeId === node.id)
  // The relation, the layer's query and its timings: for debugging the planner, not for users
  const debug = useEditor(st => st.debug)
  // Folders are sections of one long pane, as Houdini's are when expanded; each can fold away
  const [folded, setFolded] = useState<Set<string>>(new Set())
  const [name, setName] = useState(nameOf(node))
  useEffect(() => setName(nameOf(node)), [node])
  // A long description shows two lines until clicked
  const [descOpen, setDescOpen] = useState(false)
  if (!op) return <div className={s.empty}>Unknown operator {node.op}</div>

  const replaced = PANE_EDITORS[node.op]?.replaces ?? []
  const visible = op.params.filter(p => shown(p, node, op) && !replaced.includes(p.name))
  // Units, solid colors and the ramp are drawn inside the control they belong to
  const compounds = compoundsFor(op, node.params)
  const folders = [
    ...new Set(
      visible.filter(p => !compounds.absorbed.has(p.name)).map(p => p.folder ?? 'Parameters')
    ),
  ]
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
    <div className={s.pane} onChange={dismissStarterHint} onInput={dismissStarterHint}>
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
        {op.description && (
          <button
            type="button"
            className={cx(s.paneDesc, descOpen && s.paneDescOpen)}
            aria-expanded={descOpen}
            title={descOpen ? undefined : op.description}
            onClick={() => setDescOpen(o => !o)}
          >
            {op.description}
          </button>
        )}
      </div>
      {showStarterHint && (
        <div className={s.starterHint} role="status">
          {STARTER_HINT_TEXT}
        </div>
      )}
      {errors.map(e => (
        <div className={s.error} key={e}>
          {e}
        </div>
      ))}
      <PaneEditorFor node={node} />
      <div className={s.params}>
        {fields &&
          folders.map(f => {
            const open = !folded.has(f)
            return (
              <section key={f} className={s.folder}>
                {folders.length > 1 && (
                  <button
                    type="button"
                    className={s.folderHead}
                    aria-expanded={open}
                    onClick={() =>
                      setFolded(prev => {
                        const next = new Set(prev)
                        if (open) next.add(f)
                        else next.delete(f)
                        return next
                      })
                    }
                  >
                    <span className={s.folderChevron}>{open ? '▾' : '▸'}</span>
                    {f}
                  </button>
                )}
                {open &&
                  visible
                    .filter(
                      p => (p.folder ?? 'Parameters') === f && !compounds.absorbed.has(p.name)
                    )
                    .map(def => {
                      const color = compounds.colors.find(c => c.channel === def.name)
                      if (color)
                        return (
                          <ColorGroupRows
                            key={def.name}
                            node={node}
                            doc={doc}
                            group={color}
                            fields={fields}
                            wired={wired}
                            showRamp={compounds.rampIn === color.channel}
                          />
                        )
                      const b = fields.bindings.get(def.name)
                      const units = compounds.units.find(u => u.value === def.name)
                      const unitsDef = units && op.params.find(p => p.name === units.units)
                      return b ? (
                        <ParamRow
                          key={def.name}
                          node={node}
                          def={def}
                          field={b.field}
                          wired={wired.has(`par:${def.name}`)}
                          inline={unitsDef && <UnitsSelect node={node} def={unitsDef} />}
                        />
                      ) : null
                    })}
              </section>
            )
          })}
        {node.op === 'subnet' && <Promoted subnet={node} doc={doc} />}
      </div>
      {debug && <NodeInfo node={node} op={op} engine={engine} />}
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
