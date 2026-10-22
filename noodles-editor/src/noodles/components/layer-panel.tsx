import { nameOf, OPERATOR_INDEX, type ParamDef } from '@noodles.gl/planner'
import { useReactFlow } from '@xyflow/react'
import { useCallback, useMemo, useState } from 'react'
import { setParam } from '../../editor/doc-ops'
import { docStore, useEditor } from '../../editor/doc-store'
import { colorToFieldHex, fieldHexToColor } from '../../editor/field-adapter'
import { analytics } from '../../utils/analytics'
import s from './layer-panel.module.css'

interface LayerInfo {
  id: string
  name: string
  displayName: string
  visible: boolean
  opacity: number
}

/** A layer's style parameters: the plain colors, numbers and toggles in its Style folder. */
const isStyle = (d: ParamDef) =>
  d.folder === 'Style' &&
  ['color', 'float', 'int', 'toggle'].includes(d.kind) &&
  d.name !== 'opacity'

function StyleEditor({ layerId }: StyleEditorProps) {
  const node = useEditor(st => st.doc.nodes.find(n => n.id === layerId))
  const time = useEditor(st => st.time)
  if (!node) return null
  const defs = (OPERATOR_INDEX.get(node.op)?.params ?? []).filter(isStyle)
  if (defs.length === 0) return null
  const value = (d: ParamDef) => node.params[d.name] ?? d.default
  const set = (d: ParamDef, v: unknown) =>
    docStore().edit(
      doc => setParam(doc, layerId, d.name, v as never, time),
      `p:${layerId}.${d.name}`
    )

  return (
    <div className={s.styleEditor}>
      {defs.map(d => {
        if (d.kind === 'color') {
          return (
            <div key={d.name} className={s.styleRow}>
              <span className={s.styleLabel}>{d.label}</span>
              <input
                type="color"
                className={s.colorInput}
                value={colorToFieldHex(value(d))}
                onChange={e => set(d, fieldHexToColor(e.target.value))}
              />
            </div>
          )
        }
        if (d.kind === 'toggle') {
          const on = value(d) === true
          return (
            <div key={d.name} className={s.styleRow}>
              <span className={s.styleLabel}>{d.label}</span>
              <button
                type="button"
                className={`${s.toggleButton} ${on ? s.toggleOn : ''}`}
                onClick={() => set(d, !on)}
              >
                {on ? 'On' : 'Off'}
              </button>
            </div>
          )
        }
        const min = d.min ?? 0
        const max = d.max ?? 100
        const step = d.step ?? (max <= 1 ? 0.01 : 1)
        const n = Number(value(d) ?? 0)
        return (
          <div key={d.name} className={s.styleRow}>
            <span className={s.styleLabel}>{d.label}</span>
            <div className={s.numberControl}>
              <input
                type="range"
                className={s.styleSlider}
                min={min}
                max={max}
                step={step}
                value={Number.isFinite(n) ? n : 0}
                onChange={e => set(d, Number(e.target.value))}
              />
              <span className={s.numberValue}>
                {Number.isFinite(n) ? n.toFixed(step < 1 ? 2 : 0) : '0'}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

interface StyleEditorProps {
  layerId: string
}

export function LayerPanel() {
  const doc = useEditor(st => st.doc)
  const reactFlow = useReactFlow()
  const [expandedLayer, setExpandedLayer] = useState<string | null>(null)

  // What the deck draws, in its order: the wires into its layers port
  const layers = useMemo(() => {
    const deck = doc.nodes.find(n => n.op === 'deck')
    if (!deck) return []
    return doc.edges
      .filter(e => e.target === deck.id && e.targetPort === 'layers')
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map(e => doc.nodes.find(n => n.id === e.source))
      .filter((n): n is NonNullable<typeof n> => !!n)
      .map(
        n =>
          ({
            id: n.id,
            name: nameOf(n),
            displayName: OPERATOR_INDEX.get(n.op)?.label ?? n.op,
            visible: !n.flags?.bypass,
            opacity: Number(
              n.params.opacity ??
                OPERATOR_INDEX.get(n.op)?.params.find(p => p.name === 'opacity')?.default ??
                1
            ),
          }) satisfies LayerInfo
      )
  }, [doc])

  // Hiding a layer bypasses it: the deck draws without it, and its parameters stay
  const handleToggleVisible = useCallback((id: string) => {
    const store = docStore()
    const node = store.get().doc.nodes.find(n => n.id === id)
    const visible = !node?.flags?.bypass
    store.edit(d => {
      const n = d.nodes.find(x => x.id === id)
      if (n) n.flags = { ...n.flags, bypass: visible }
    })
    analytics.track('layer_panel_toggle_visible', { visible: !visible })
  }, [])

  const handleOpacityChange = useCallback((id: string, value: number) => {
    const store = docStore()
    store.edit(d => setParam(d, id, 'opacity', value, store.get().time), `p:${id}.opacity`)
  }, [])

  const handleSelectLayer = useCallback((id: string) => {
    setExpandedLayer(prev => (prev === id ? null : id))
  }, [])

  const handleNavigateToNode = useCallback(
    (id: string) => {
      docStore().set({ selection: [id] })
      reactFlow.fitView({ nodes: [{ id }], duration: 300, padding: 0.5 })
    },
    [reactFlow]
  )

  if (layers.length === 0) {
    return (
      <div className={s.container}>
        <div className={s.header}>Layers</div>
        <div className={s.emptyState}>
          No layers connected to a renderer.
          <br />
          Import data or add a layer node to get started.
        </div>
      </div>
    )
  }

  return (
    <div className={s.container}>
      <div className={s.header}>Layers</div>
      <div className={s.list}>
        {layers.map(layer => (
          <div
            key={layer.id}
            className={`${s.layerGroup} ${expandedLayer === layer.id ? s.layerGroupExpanded : ''}`}
          >
            <div className={s.layerItem}>
              <button
                type="button"
                className={s.visibilityButton}
                onClick={() => handleToggleVisible(layer.id)}
                title={layer.visible ? 'Hide layer' : 'Show layer'}
              >
                <i className={layer.visible ? 'pi pi-eye' : 'pi pi-eye-slash'} />
              </button>
              <button
                type="button"
                className={s.layerInfo}
                onClick={() => handleSelectLayer(layer.id)}
              >
                <span className={s.layerName}>{layer.name}</span>
                <span className={s.layerType}>{layer.displayName}</span>
              </button>
              <input
                type="range"
                className={s.opacitySlider}
                min={0}
                max={1}
                step={0.05}
                value={layer.opacity}
                onChange={e => handleOpacityChange(layer.id, Number(e.target.value))}
                title={`Opacity: ${Math.round(layer.opacity * 100)}%`}
              />
              <button
                type="button"
                className={s.navigateButton}
                onClick={() => handleNavigateToNode(layer.id)}
                title="Show in graph"
              >
                <i className="pi pi-external-link" />
              </button>
            </div>
            {expandedLayer === layer.id && <StyleEditor layerId={layer.id} />}
          </div>
        ))}
      </div>
    </div>
  )
}
