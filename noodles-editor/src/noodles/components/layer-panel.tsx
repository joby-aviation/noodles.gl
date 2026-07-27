import { useEdges, useReactFlow } from '@xyflow/react'
import { useCallback, useMemo, useState } from 'react'
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

const STYLE_FIELDS: Record<string, string[]> = {
  ScatterplotLayer: ['getFillColor', 'getLineColor', 'getRadius', 'stroked', 'radiusScale'],
  PathLayer: ['getColor', 'getWidth', 'widthScale', 'capRounded'],
  ArcLayer: ['getSourceColor', 'getTargetColor', 'getWidth', 'getHeight'],
  GeoJsonLayer: ['getFillColor', 'getLineColor', 'getLineWidth', 'filled', 'stroked', 'extruded'],
  PolygonLayer: ['getFillColor', 'getLineColor', 'getLineWidth', 'filled', 'stroked', 'extruded'],
  HeatmapLayer: ['intensity', 'radiusPixels', 'threshold'],
  ColumnLayer: ['getFillColor', 'getLineColor', 'getElevation', 'radius', 'extruded'],
  H3HexagonLayer: ['getFillColor', 'getLineColor', 'getElevation', 'extruded'],
  IconLayer: ['getSize', 'getColor', 'sizeScale'],
  TextLayer: ['getColor', 'getSize', 'sizeScale'],
}

function isColorField(field: { constructor: { name: string } }): boolean {
  return field.constructor.name === 'ColorField'
}

function isNumberField(field: { constructor: { name: string } }): boolean {
  return field.constructor.name === 'NumberField'
}

function isBooleanField(field: { constructor: { name: string } }): boolean {
  return field.constructor.name === 'BooleanField'
}

interface StyleEditorProps {
  layerId: string
}

function StyleEditor({ layerId }: StyleEditorProps) {
  const op = useOperatorStore(state => state.operators.get(layerId))
  if (!op) return null

  const displayName = (op.constructor as typeof Operator).displayName
  const fieldNames = STYLE_FIELDS[displayName] ?? []
  const editableFields = fieldNames.filter(name => name in op.inputs)

  if (editableFields.length === 0) return null

  return (
    <div className={s.styleEditor}>
      {editableFields.map(name => {
        const field = op.inputs[name]
        if (!field) return null

        if (isColorField(field)) {
          return (
            <div key={name} className={s.styleRow}>
              <span className={s.styleLabel}>{formatLabel(name)}</span>
              <input
                type="color"
                className={s.colorInput}
                value={typeof field.value === 'string' ? field.value : '#ffffff'}
                onChange={e => field.setValue(e.target.value)}
              />
            </div>
          )
        }

        if (isNumberField(field)) {
          const opts = field.options ?? {}
          const min = opts.min ?? 0
          const max = opts.softMax ?? opts.max ?? 100
          const step = opts.step ?? (max <= 1 ? 0.01 : 1)
          return (
            <div key={name} className={s.styleRow}>
              <span className={s.styleLabel}>{formatLabel(name)}</span>
              <div className={s.numberControl}>
                <input
                  type="range"
                  className={s.styleSlider}
                  min={min}
                  max={max}
                  step={step}
                  value={field.value ?? 0}
                  onChange={e => field.setValue(Number(e.target.value))}
                />
                <span className={s.numberValue}>
                  {typeof field.value === 'number' ? field.value.toFixed(step < 1 ? 2 : 0) : '0'}
                </span>
              </div>
            </div>
          )
        }

        if (isBooleanField(field)) {
          return (
            <div key={name} className={s.styleRow}>
              <span className={s.styleLabel}>{formatLabel(name)}</span>
              <button
                type="button"
                className={`${s.toggleButton} ${field.value ? s.toggleOn : ''}`}
                onClick={() => field.setValue(!field.value)}
              >
                {field.value ? 'On' : 'Off'}
              </button>
            </div>
          )
        }

        return null
      })}
    </div>
  )
}

function formatLabel(fieldName: string): string {
  return fieldName
    .replace(/^get/, '')
    .replace(/([A-Z])/g, ' $1')
    .trim()
}

export function LayerPanel() {
  const operators = useOperatorStore(state => state.operators)
  const edges = useEdges()
  const reactFlow = useReactFlow()
  const [expandedLayer, setExpandedLayer] = useState<string | null>(null)

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

  const handleSelectLayer = useCallback((id: string) => {
    setExpandedLayer(prev => (prev === id ? null : id))
  }, [])

  const handleNavigateToNode = useCallback(
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
