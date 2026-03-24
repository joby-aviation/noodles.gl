import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import type { NodeProps as ReactFlowNodeProps } from '@xyflow/react'
import cx from 'classnames'
import { useEffect, useState } from 'react'

import { analytics } from '../../utils/analytics'
import {
  CATEGORY_ORDER,
  getEditableColorProps,
  groupLayersByCategory,
  type LayerCategory,
  type MaplibreLayer,
  type MaplibreStyle,
  type StyleConfiguratorData,
} from '../../utils/map-style-utils'
import type { Field, IField } from '../fields'
import s from '../noodles.module.css'
import type { IOperator, MapStyleConfiguratorOp, Operator } from '../operators'
import { getOp } from '../store'
import type { NodeDataJSON } from '../transform-graph'
import { usePropertyHistory } from '../utils/property-history'
import { ColorSwatch } from './color-swatch'
import { FieldComponent } from './field-components'
import configuratorStyles from './map-style-configurator.module.css'
import {
  NodeHeader,
  OutputHandle,
  PAR_HANDLE_OPTIONS,
  useFieldVisibility,
  useLocked,
  useNodeDimmed,
} from './op-components'

function LayerRow({
  layer,
  layerOverride,
  onVisibilityChange,
  onColorChange,
}: {
  layer: MaplibreLayer
  layerOverride: StyleConfiguratorData['layers'][number] | undefined
  onVisibilityChange: (visible: boolean) => void
  onColorChange: (prop: string, color: string) => void
}) {
  const isHidden = layerOverride?.layoutOverrides?.['visibility'] === 'none'
  const colorProps = getEditableColorProps(layer)

  return (
    <div className={configuratorStyles.layerRow}>
      <span className={configuratorStyles.layerTypeBadge}>{layer.type}</span>
      <span className={configuratorStyles.layerId} title={layer.id}>
        {layer.id}
      </span>
      <div className={configuratorStyles.layerColors}>
        {colorProps.map(prop => {
          const overriddenColor = layerOverride?.paintOverrides?.[prop] as string | undefined
          const originalColor = layer.paint?.[prop] as string | undefined
          // Only show swatch if the layer has a plain string color we can edit
          if (!overriddenColor && typeof originalColor !== 'string') return null
          return (
            <ColorSwatch
              key={prop}
              value={overriddenColor ?? originalColor ?? '#888888'}
              onChange={color => onColorChange(prop, color)}
            />
          )
        })}
      </div>
      <button
        type="button"
        className={cx(
          configuratorStyles.visibilityToggle,
          isHidden && configuratorStyles.visibilityToggleHidden
        )}
        onClick={() => onVisibilityChange(!isHidden)}
        title={isHidden ? 'Show layer' : 'Hide layer'}
      >
        {isHidden ? '○' : '●'}
      </button>
    </div>
  )
}

interface ConfiguratorDialogProps {
  op: Operator<MapStyleConfiguratorOp>
  open: boolean
  onOpenChange: (open: boolean) => void
}

function MapStyleConfiguratorDialog({ op, open, onOpenChange }: ConfiguratorDialogProps) {
  const [styleJson, setStyleJson] = useState<MaplibreStyle | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [overrides, setOverrides] = useState<StyleConfiguratorData>(
    (op.inputs.overrides.value as StyleConfiguratorData) ?? { layers: [], global: {} }
  )
  const [collapsedCategories, setCollapsedCategories] = useState<Set<LayerCategory>>(new Set())
  const { captureStart, commitChange } = usePropertyHistory()

  // Fetch style when dialog opens or baseStyle changes
  useEffect(() => {
    if (!open) return
    const baseStyle = op.inputs.baseStyle.value as string | object
    if (!baseStyle) {
      setStyleJson(null)
      return
    }

    if (typeof baseStyle === 'object') {
      setStyleJson(baseStyle as MaplibreStyle)
      return
    }

    const controller = new AbortController()
    setLoading(true)
    setError(null)
    fetch(baseStyle, { signal: controller.signal })
      .then(r => {
        if (!r.ok) throw new Error(`Failed to fetch style: ${r.statusText}`)
        return r.json()
      })
      .then((json: MaplibreStyle) => {
        setStyleJson(json)
        setLoading(false)
      })
      .catch((err: Error) => {
        if (err.name === 'AbortError') return
        setError(err.message)
        setLoading(false)
      })
    return () => controller.abort()
  }, [open, op])

  // Sync overrides from field when dialog opens
  useEffect(() => {
    if (open) {
      setOverrides(
        (op.inputs.overrides.value as StyleConfiguratorData) ?? { layers: [], global: {} }
      )
    }
  }, [open, op])

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      captureStart()
      analytics.track('map_style_configurator_opened')
    } else {
      commitChange('Configure map style')
    }
    onOpenChange(nextOpen)
  }

  const updateOverrides = (next: StyleConfiguratorData) => {
    setOverrides(next)
    op.inputs.overrides.setValue(next)
  }

  const updateLayerPaint = (layerId: string, prop: string, value: string) => {
    const layers = overrides.layers ?? []
    const idx = layers.findIndex(o => o.layerId === layerId)
    const updated =
      idx >= 0
        ? layers.map((o, i) =>
            i === idx ? { ...o, paintOverrides: { ...(o.paintOverrides ?? {}), [prop]: value } } : o
          )
        : [...layers, { layerId, paintOverrides: { [prop]: value } }]
    updateOverrides({ ...overrides, layers: updated })
  }

  const updateLayerVisibility = (layerId: string, visible: boolean) => {
    const layers = overrides.layers ?? []
    const visibility = visible ? 'visible' : 'none'
    const idx = layers.findIndex(o => o.layerId === layerId)
    const updated =
      idx >= 0
        ? layers.map((o, i) =>
            i === idx ? { ...o, layoutOverrides: { ...(o.layoutOverrides ?? {}), visibility } } : o
          )
        : [...layers, { layerId, layoutOverrides: { visibility } }]
    updateOverrides({ ...overrides, layers: updated })
  }

  const updateGlobal = (key: keyof StyleConfiguratorData['global'], value: unknown) => {
    updateOverrides({ ...overrides, global: { ...(overrides.global ?? {}), [key]: value } })
  }

  const handleReset = () => {
    updateOverrides({ layers: [], global: {} })
    analytics.track('map_style_configurator_reset')
  }

  const toggleCategory = (category: LayerCategory) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }

  const groupedLayers = styleJson ? groupLayersByCategory(styleJson.layers ?? []) : null
  // Count only entries with meaningful changes (ignore no-op visibility resets)
  const totalOverrides =
    overrides.layers?.filter(o => {
      const hasHiddenLayer = o.layoutOverrides?.['visibility'] === 'none'
      const hasPaintOverride = o.paintOverrides && Object.keys(o.paintOverrides).length > 0
      const hasOtherLayout =
        o.layoutOverrides &&
        Object.entries(o.layoutOverrides).some(([k, v]) => !(k === 'visibility' && v === 'visible'))
      return hasHiddenLayer || hasPaintOverride || hasOtherLayout
    }).length ?? 0

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={configuratorStyles.overlay} />
        <Dialog.Content
          className={configuratorStyles.content}
          // Prevent the dialog from closing when clicking the portaled color picker,
          // which renders outside the dialog's DOM node via createPortal
          onPointerDownOutside={e => e.preventDefault()}
          onInteractOutside={e => e.preventDefault()}
        >
          <Dialog.Title className={configuratorStyles.title}>Map Style Configurator</Dialog.Title>
          <Dialog.Close asChild>
            <button type="button" className={configuratorStyles.closeButton} aria-label="Close">
              <Cross2Icon />
            </button>
          </Dialog.Close>

          {loading && <div className={configuratorStyles.loading}>Loading style layers…</div>}
          {error && <div className={configuratorStyles.error}>{error}</div>}
          {!loading && !error && !styleJson && (
            <div className={configuratorStyles.emptyState}>
              Set a base style URL in the node to configure layers.
            </div>
          )}

          {styleJson && (
            <>
              <div className={configuratorStyles.globalSection}>
                <div className={configuratorStyles.globalSectionTitle}>Global</div>
                <div className={configuratorStyles.globalRow}>
                  <span className={configuratorStyles.globalLabel}>Label size scale</span>
                  <input
                    type="range"
                    min={0.5}
                    max={3}
                    step={0.05}
                    value={overrides.global?.labelSizeScale ?? 1}
                    onChange={e => updateGlobal('labelSizeScale', parseFloat(e.target.value))}
                    className={configuratorStyles.globalInput}
                    style={{ padding: 0 }}
                  />
                  <span className={configuratorStyles.scaleValue}>
                    {(overrides.global?.labelSizeScale ?? 1).toFixed(2)}×
                  </span>
                </div>
                <div className={configuratorStyles.globalRow}>
                  <span className={configuratorStyles.globalLabel}>Glyphs URL</span>
                  <input
                    type="text"
                    placeholder={styleJson.glyphs ?? 'default font URL'}
                    value={overrides.global?.glyphs ?? ''}
                    onChange={e => updateGlobal('glyphs', e.target.value || undefined)}
                    className={configuratorStyles.globalInput}
                  />
                </div>
              </div>

              {CATEGORY_ORDER.map(category => {
                const layers = groupedLayers?.[category] ?? []
                if (layers.length === 0) return null
                const isCollapsed = collapsedCategories.has(category)
                const categoryOverrides = overrides.layers?.filter(o =>
                  layers.some(l => l.id === o.layerId)
                )
                const hasOverrides = (categoryOverrides?.length ?? 0) > 0

                return (
                  <div key={category} className={configuratorStyles.categorySection}>
                    <button
                      type="button"
                      className={configuratorStyles.categoryHeader}
                      onClick={() => toggleCategory(category)}
                    >
                      <span className={configuratorStyles.chevron}>{isCollapsed ? '▶' : '▼'}</span>
                      <span className={configuratorStyles.categoryName}>{category}</span>
                      {hasOverrides && (
                        <span className={configuratorStyles.modifiedDot} title="Has overrides" />
                      )}
                      <span className={configuratorStyles.layerCount}>({layers.length})</span>
                    </button>

                    {!isCollapsed && (
                      <div className={configuratorStyles.layerList}>
                        {layers.map(layer => (
                          <LayerRow
                            key={layer.id}
                            layer={layer}
                            layerOverride={overrides.layers?.find(o => o.layerId === layer.id)}
                            onVisibilityChange={visible => updateLayerVisibility(layer.id, visible)}
                            onColorChange={(prop, color) => updateLayerPaint(layer.id, prop, color)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}

              <div className={configuratorStyles.footer}>
                <button
                  type="button"
                  className={configuratorStyles.resetButton}
                  onClick={handleReset}
                >
                  Reset All Overrides
                </button>
                <span className={configuratorStyles.layerInfo}>
                  {totalOverrides > 0
                    ? `${totalOverrides} layer${totalOverrides === 1 ? '' : 's'} modified`
                    : 'No overrides'}
                </span>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function MapStyleConfiguratorOpComponent({
  id,
  type,
}: ReactFlowNodeProps<NodeDataJSON<MapStyleConfiguratorOp>> & {
  type: 'MapStyleConfiguratorOp'
}) {
  const op = getOp(id as string)
  if (!op) throw new Error(`Operator with id ${id} not found`)

  const isDimmed = useNodeDimmed(id)
  const locked = useLocked(op as Operator<IOperator>)
  const [dialogOpen, setDialogOpen] = useState(false)
  useFieldVisibility(op as Operator<IOperator>)

  return (
    <div className={cx(s.wrapper, { [s.wrapperDimmed]: isDimmed })}>
      <NodeHeader id={id} type={type} op={op as Operator<IOperator>} />
      <div className={s.content}>
        <FieldComponent
          id="baseStyle"
          field={op.inputs.baseStyle as Field<IField>}
          disabled={locked}
          handle={PAR_HANDLE_OPTIONS}
        />
        <button
          type="button"
          className={s.configureButton}
          onClick={() => setDialogOpen(true)}
          disabled={locked}
        >
          Configure Style
        </button>
        <div className={s.outputHandleContainer}>
          <OutputHandle id="mapStyle" field={op.outputs.mapStyle as Field<IField>} />
        </div>
      </div>
      <MapStyleConfiguratorDialog
        op={op as Operator<MapStyleConfiguratorOp>}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  )
}
