import { useEdges, useReactFlow } from '@xyflow/react'
import { useCallback, useMemo } from 'react'
import { analytics } from '../../utils/analytics'
import type { Operator } from '../operators'
import { useOperatorStore } from '../store'
import { getBaseName } from '../utils/path-utils'
import s from './layer-panel.module.css'

interface LayerInfo {
  id: string
  name: string
  displayName: string
  visible: boolean
  opacity: number
}

export function LayerPanel() {
  const operators = useOperatorStore(state => state.operators)
  const edges = useEdges()
  const reactFlow = useReactFlow()

  const layers = useMemo(() => {
    const rendererIds = new Set(
      Array.from(operators.entries())
        .filter(([, op]) => (op.constructor as typeof Operator).displayName === 'DeckRenderer')
        .map(([id]) => id)
    )

    const layerNodeIds = edges
      .filter(e => rendererIds.has(e.target) && e.targetHandle === 'par.layers')
      .map(e => e.source)

    return layerNodeIds
      .map(id => {
        const op = operators.get(id)
        if (!op) return null
        const displayName = (op.constructor as typeof Operator).displayName
        const visible = op.inputs.visible?.value ?? true
        const opacity = op.inputs.opacity?.value ?? 1
        return {
          id,
          name: getBaseName(id) || id,
          displayName,
          visible,
          opacity,
        } satisfies LayerInfo
      })
      .filter((l): l is LayerInfo => l !== null)
  }, [operators, edges])

  const handleToggleVisible = useCallback((id: string) => {
    const op = useOperatorStore.getState().operators.get(id)
    if (!op?.inputs.visible) return
    const current = op.inputs.visible.value ?? true
    op.inputs.visible.setValue(!current)
    analytics.track('layer_panel_toggle_visible', { visible: !current })
  }, [])

  const handleOpacityChange = useCallback((id: string, value: number) => {
    const op = useOperatorStore.getState().operators.get(id)
    if (!op?.inputs.opacity) return
    op.inputs.opacity.setValue(value)
  }, [])

  const handleSelectLayer = useCallback(
    (id: string) => {
      reactFlow.setNodes(ns => ns.map(n => ({ ...n, selected: n.id === id })))
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
          <div key={layer.id} className={s.layerItem}>
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
          </div>
        ))}
      </div>
    </div>
  )
}
