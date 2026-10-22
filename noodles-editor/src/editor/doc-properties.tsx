// The properties panel: the selected node's name, why it drew nothing, and every parameter,
// grouped by folder.

import { nameOf, OPERATOR_INDEX } from '@noodles.gl/planner'
import { useEffect, useState } from 'react'
import s from './doc-editor.module.css'
import { useEngineState } from './doc-engine'
import { ParamRow, shown, useNodeFields } from './doc-node'
import { renameNode } from './doc-ops'
import { docStore, useEditor } from './doc-store'

const NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/

export function DocProperties() {
  const selection = useEditor(s => s.selection)
  const node = useEditor(s =>
    s.selection.length === 1 ? s.doc.nodes.find(n => n.id === s.selection[0]) : undefined
  )
  const edges = useEditor(s => s.doc.edges)
  const { errors } = useEngineState()
  const fields = useNodeFields(node)
  const [name, setName] = useState('')
  useEffect(() => setName(node ? nameOf(node) : ''), [node])

  if (!node) {
    return (
      <div className={s.empty}>
        {selection.length > 1 ? `${selection.length} nodes selected` : 'Select a node to edit it'}
      </div>
    )
  }
  const op = OPERATOR_INDEX.get(node.op)
  const nodeErrors = errors.filter(e => e.nodeId === node.id)
  const wired = new Set(edges.filter(e => e.target === node.id).map(e => e.targetPort))
  const commitName = () => {
    const next = name.trim()
    if (next === nameOf(node)) return
    const taken = docStore()
      .get()
      .doc.nodes.some(n => n.id !== node.id && n.parent === node.parent && nameOf(n) === next)
    if (!NAME.test(next) || taken) {
      setName(nameOf(node))
      return
    }
    docStore().edit(d => {
      renameNode(d, node.id, next)
    })
  }

  const folders = new Map<string, NonNullable<typeof op>['params']>()
  for (const def of op?.params ?? []) {
    if (!shown(def, node, op as NonNullable<typeof op>)) continue
    const folder = def.folder ?? 'Parameters'
    folders.set(folder, [...(folders.get(folder) ?? []), def])
  }

  return (
    <div className={s.panel}>
      <div className={s.panelTitle}>
        <input
          value={name}
          aria-label="Node name"
          onChange={e => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={e => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') setName(nameOf(node))
          }}
        />
        <span>{op?.label ?? node.op}</span>
      </div>
      {op?.description && <div className={s.menuHeading}>{op.description}</div>}
      {nodeErrors.map(e => (
        <div className={s.error} key={e.message}>
          {e.message}
        </div>
      ))}
      {fields &&
        [...folders].map(([folder, defs]) => (
          <div key={folder}>
            {folders.size > 1 && <div className={s.folder}>{folder}</div>}
            {defs.map(def => {
              const b = fields.bindings.get(def.name)
              return b ? (
                <ParamRow
                  key={def.name}
                  def={def}
                  field={b.field}
                  driven={b.driven}
                  wired={wired.has(`par:${def.name}`)}
                  handle={false}
                />
              ) : null
            })}
          </div>
        ))}
    </div>
  )
}
