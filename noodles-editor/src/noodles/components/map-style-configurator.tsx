// The style editor: a modal over the editor, as Maputnik and Mapbox Studio lay theirs out. The
// style's layers on the left (grouped, searchable, each with its eye and colors), the selected
// layer's properties in the middle (map-style-properties.tsx), and the style drawn live on the
// right; clicking the map selects the layer drawn there. The whole style's scales sit at the top
// of the list. Changes are kept apart from the base style (StyleConfiguratorData), so the base
// can change under them.

import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon, EyeNoneIcon, EyeOpenIcon } from '@radix-ui/react-icons'
import cx from 'classnames'
import { useEffect, useMemo, useState } from 'react'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Map as MapLibre, NavigationControl } from 'react-map-gl/maplibre'

import { analytics } from '../../utils/analytics'
import { debugUI } from '../../utils/debug'
import { loadStyleSpec, type StyleSpec, withLayerProp } from '../../utils/map-style-props'
import {
  applyStyleOverrides,
  CATEGORY_ORDER,
  getEditableColorProps,
  groupLayersByCategory,
  type LayerCategory,
  type MaplibreLayer,
  type MaplibreStyle,
  type StyleConfiguratorData,
} from '../../utils/map-style-utils'
import { CARTO_DARK } from '../../utils/map-styles'
import { ColorSwatch } from './color-swatch'
import { useDeferredCommit } from './deferred-commit'
import configuratorStyles from './map-style-configurator.module.css'
import { LayerInspector } from './map-style-properties'

export function LayerRow({
  layer,
  layerOverride,
  onVisibilityChange,
  onColorChange,
  selected,
  onSelect,
}: {
  layer: MaplibreLayer
  layerOverride: StyleConfiguratorData['layers'][number] | undefined
  onVisibilityChange: (visible: boolean) => void
  onColorChange: (prop: string, color: string) => void
  selected?: boolean
  onSelect?: () => void
}) {
  const isHidden =
    (layerOverride?.layoutOverrides?.['visibility'] ?? layer.layout?.['visibility']) === 'none'
  const colorProps = getEditableColorProps(layer)
  const changed =
    Object.keys(layerOverride?.paintOverrides ?? {}).length > 0 ||
    Object.keys(layerOverride?.layoutOverrides ?? {}).some(k => k !== 'visibility')

  return (
    <div
      className={cx(configuratorStyles.layerRow, selected && configuratorStyles.layerRowSelected)}
    >
      <button
        type="button"
        className={configuratorStyles.layerSelect}
        onClick={onSelect}
        aria-pressed={selected}
        title={`${layer.id}: edit its properties`}
      >
        <span className={configuratorStyles.layerTypeBadge}>{layer.type}</span>
        <span
          className={cx(configuratorStyles.layerId, isHidden && configuratorStyles.layerIdHidden)}
        >
          {layer.id}
        </span>
        {changed && <span className={configuratorStyles.modifiedDot} title="Changed" />}
      </button>
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
        onClick={() => onVisibilityChange(isHidden)}
        title={isHidden ? 'Show layer' : 'Hide layer'}
      >
        {isHidden ? <EyeNoneIcon /> : <EyeOpenIcon />}
      </button>
    </div>
  )
}

interface ConfiguratorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The style being changed: a URL, or a style object. */
  baseStyle: string | object | undefined
  overrides: StyleConfiguratorData | undefined
  onOverridesChange: (overrides: StyleConfiguratorData) => void
  /** Bracket the edits made while the dialog is open, as one undo step. */
  onEditStart?: () => void
  onEditEnd?: () => void
  /** Where the preview opens: the deck's camera, say. */
  initialView?: { longitude: number; latitude: number; zoom: number }
}

const NYC = { longitude: -74.006, latitude: 40.7128, zoom: 9 }

// Whether edits reach the project as they are made, rather than when the editor closes
const LIVE_KEY = 'noodles-style-editor-live'
const readLive = () => {
  try {
    return localStorage.getItem(LIVE_KEY) === 'true'
  } catch {
    return false
  }
}
const WHOLE_STYLE = ''

export function MapStyleConfiguratorDialog({
  open,
  onOpenChange,
  baseStyle,
  overrides: given,
  onOverridesChange,
  onEditStart,
  onEditEnd,
  initialView,
}: ConfiguratorDialogProps) {
  debugUI('MapStyleConfiguratorDialog render open=%s', open)
  const [styleJson, setStyleJson] = useState<MaplibreStyle | null>(null)
  const [spec, setSpec] = useState<StyleSpec>()
  const [specError, setSpecError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [overrides, setOverrides] = useState<StyleConfiguratorData>(
    given ?? { layers: [], global: {} }
  )
  const [collapsedCategories, setCollapsedCategories] = useState<Set<LayerCategory>>(new Set())
  const [mapView, setMapView] = useState(initialView ?? NYC)
  const [selected, setSelected] = useState(WHOLE_STYLE)
  const [search, setSearch] = useState('')

  const mergedStyle = useMemo(
    () => (styleJson ? applyStyleOverrides(styleJson, overrides) : null),
    [styleJson, overrides]
  )
  const previewMapStyle =
    mergedStyle ?? (typeof baseStyle === 'string' ? baseStyle : null) ?? CARTO_DARK

  useEffect(() => {
    if (!open) return
    setSpecError(undefined)
    loadStyleSpec().then(setSpec, (err: Error) =>
      setSpecError(`The style spec didn't load, so layer properties can't be shown: ${err.message}`)
    )
  }, [open])

  // Fetch style when dialog opens or baseStyle changes
  useEffect(() => {
    if (!open) return
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
  }, [open, baseStyle])

  // Sync overrides from the value when the dialog opens
  // biome-ignore lint/correctness/useExhaustiveDependencies: the overrides and camera are read as the dialog opens
  useEffect(() => {
    if (open) {
      setOverrides(given ?? { layers: [], global: {} })
      if (initialView) setMapView(initialView)
    }
  }, [open])

  // Edits redraw this editor's own map as they are made; the project (the deck's map, the
  // document, undo) takes them when the editor closes, or every LIVE_MS with Live update on.
  // Each edit reaching the project restyles the main map, which is what made dragging a
  // color slow.
  const [live, setLive] = useState(readLive)
  const { change, commit } = useDeferredCommit(onOverridesChange, live, open)

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      onEditStart?.()
      analytics.track('map_style_configurator_opened')
    } else {
      commit()
      onEditEnd?.()
    }
    onOpenChange(nextOpen)
  }

  const updateOverrides = (next: StyleConfiguratorData) => {
    setOverrides(next)
    change(next)
  }

  const toggleLive = (on: boolean) => {
    setLive(on)
    try {
      localStorage.setItem(LIVE_KEY, String(on))
    } catch {
      // Storage off: the choice lasts this session
    }
    analytics.track('map_style_configurator_live', { on })
  }

  const setLayerProp = (layerId: string, group: 'paint' | 'layout', prop: string, value: unknown) =>
    updateOverrides(withLayerProp(overrides, layerId, group, prop, value))

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

  const q = search.trim().toLowerCase()
  const layers = (styleJson?.layers ?? []).filter(
    l => !q || l.id.toLowerCase().includes(q) || l.type.includes(q)
  )
  const groupedLayers = styleJson ? groupLayersByCategory(layers) : null
  const selectedLayer = styleJson?.layers.find(l => l.id === selected)
  // Layers whose changes do something: visibility counts when it differs from the base
  // style's own (an older style editor wrote `visible` over layers that already were)
  const baseVisibility = (id: string) =>
    styleJson?.layers.find(l => l.id === id)?.layout?.['visibility'] ?? 'visible'
  const totalOverrides =
    overrides.layers?.filter(
      o =>
        Object.keys(o.paintOverrides ?? {}).length > 0 ||
        Object.entries(o.layoutOverrides ?? {}).some(
          ([k, v]) => k !== 'visibility' || v !== baseVisibility(o.layerId)
        )
    ).length ?? 0

  const global = (
    <div className={configuratorStyles.globalSection}>
      <div className={configuratorStyles.globalSectionTitle}>Whole style</div>
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
        <span className={configuratorStyles.globalLabel}>Line width scale</span>
        <input
          type="range"
          min={0.25}
          max={4}
          step={0.05}
          value={overrides.global?.lineWidthScale ?? 1}
          onChange={e => updateGlobal('lineWidthScale', parseFloat(e.target.value))}
          className={configuratorStyles.globalInput}
          style={{ padding: 0 }}
        />
        <span className={configuratorStyles.scaleValue}>
          {(overrides.global?.lineWidthScale ?? 1).toFixed(2)}×
        </span>
      </div>
      <div className={configuratorStyles.globalRow}>
        <span className={configuratorStyles.globalLabel}>Glyphs URL</span>
        <input
          type="text"
          placeholder={styleJson?.glyphs ?? 'default font URL'}
          value={overrides.global?.glyphs ?? ''}
          onChange={e => updateGlobal('glyphs', e.target.value || undefined)}
          className={configuratorStyles.globalInput}
        />
      </div>
      <p className={configuratorStyles.hint}>
        The scales multiply every line width and label size, zoom ramps included. Pick a layer on
        the left, or click the map, to edit its properties.
      </p>
    </div>
  )

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={configuratorStyles.overlay} />
        <Dialog.Content
          className={configuratorStyles.content}
          aria-describedby={undefined}
          // Prevent the dialog from closing when clicking the portaled color picker,
          // which renders outside the dialog's DOM node via createPortal
          onPointerDownOutside={e => e.preventDefault()}
          onInteractOutside={e => e.preventDefault()}
        >
          <header className={configuratorStyles.header}>
            <Dialog.Title className={configuratorStyles.title}>Style editor</Dialog.Title>
            <span className={configuratorStyles.layerInfo}>
              {totalOverrides > 0
                ? `${totalOverrides} layer${totalOverrides === 1 ? '' : 's'} changed`
                : 'No changes'}
            </span>
            <label
              className={configuratorStyles.liveToggle}
              title="Update the project's map as you edit. Off, the map takes your changes when the editor closes, which keeps editing fast."
            >
              <input type="checkbox" checked={live} onChange={e => toggleLive(e.target.checked)} />
              Live update
            </label>
            <button
              type="button"
              className={configuratorStyles.resetButton}
              onClick={handleReset}
              disabled={
                (overrides.layers?.length ?? 0) === 0 &&
                Object.keys(overrides.global ?? {}).length === 0
              }
            >
              Reset all
            </button>
            <Dialog.Close asChild>
              <button type="button" className={configuratorStyles.closeButton} aria-label="Close">
                <Cross2Icon />
              </button>
            </Dialog.Close>
          </header>

          <div className={configuratorStyles.body}>
            <aside className={configuratorStyles.layersPane}>
              {loading && <div className={configuratorStyles.loading}>Loading style layers…</div>}
              {error && <div className={configuratorStyles.error}>{error}</div>}
              {!loading && !error && !styleJson && (
                <div className={configuratorStyles.emptyState}>
                  Set a base style URL in the node to configure layers.
                </div>
              )}
              {styleJson && (
                <>
                  <button
                    type="button"
                    className={cx(
                      configuratorStyles.wholeStyle,
                      selected === WHOLE_STYLE && configuratorStyles.layerRowSelected
                    )}
                    onClick={() => setSelected(WHOLE_STYLE)}
                  >
                    Whole style
                  </button>
                  <input
                    type="search"
                    className={configuratorStyles.search}
                    placeholder={`Find among ${styleJson.layers.length} layers`}
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                  {CATEGORY_ORDER.map(category => {
                    const inCategory = groupedLayers?.[category] ?? []
                    if (inCategory.length === 0) return null
                    const isCollapsed = collapsedCategories.has(category) && !q
                    const hasOverrides = overrides.layers?.some(o =>
                      inCategory.some(l => l.id === o.layerId)
                    )

                    return (
                      <div key={category} className={configuratorStyles.categorySection}>
                        <button
                          type="button"
                          className={configuratorStyles.categoryHeader}
                          onClick={() => toggleCategory(category)}
                        >
                          <span className={configuratorStyles.chevron}>
                            {isCollapsed ? '▶' : '▼'}
                          </span>
                          <span className={configuratorStyles.categoryName}>{category}</span>
                          {hasOverrides && (
                            <span className={configuratorStyles.modifiedDot} title="Has changes" />
                          )}
                          <span className={configuratorStyles.layerCount}>
                            ({inCategory.length})
                          </span>
                        </button>

                        {!isCollapsed && (
                          <div className={configuratorStyles.layerList}>
                            {inCategory.map(layer => (
                              <LayerRow
                                key={layer.id}
                                layer={layer}
                                layerOverride={overrides.layers?.find(o => o.layerId === layer.id)}
                                selected={selected === layer.id}
                                onSelect={() => setSelected(layer.id)}
                                // Shown: the style's own visibility, or visible over a layer it hides
                                onVisibilityChange={visible =>
                                  setLayerProp(
                                    layer.id,
                                    'layout',
                                    'visibility',
                                    !visible
                                      ? 'none'
                                      : layer.layout?.['visibility'] === 'none'
                                        ? 'visible'
                                        : undefined
                                  )
                                }
                                onColorChange={(prop, color) =>
                                  setLayerProp(layer.id, 'paint', prop, color)
                                }
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </>
              )}
            </aside>

            <section className={configuratorStyles.inspectorPane}>
              {selectedLayer && spec ? (
                <LayerInspector
                  layer={selectedLayer}
                  layerOverride={overrides.layers?.find(o => o.layerId === selectedLayer.id)}
                  spec={spec}
                  zoom={mapView.zoom}
                  onChange={(group, prop, value) => {
                    setLayerProp(selectedLayer.id, group, prop, value)
                    analytics.track('map_style_property_changed', { group })
                  }}
                />
              ) : selectedLayer && specError ? (
                <div className={configuratorStyles.error}>{specError}</div>
              ) : styleJson ? (
                global
              ) : null}
            </section>

            <div className={configuratorStyles.previewPane}>
              <MapLibre
                mapStyle={previewMapStyle as unknown as string}
                style={{ width: '100%', height: '100%' }}
                longitude={mapView.longitude}
                latitude={mapView.latitude}
                zoom={mapView.zoom}
                onMove={e => setMapView(e.viewState)}
                interactiveLayerIds={styleJson?.layers.map(l => l.id)}
                cursor="crosshair"
                // The topmost layer drawn under the pointer
                onClick={e => {
                  const id = e.features?.[0]?.layer?.id
                  if (id) setSelected(id)
                }}
              >
                <NavigationControl position="top-right" showCompass={false} />
              </MapLibre>
              <span className={configuratorStyles.zoomBadge}>zoom {mapView.zoom.toFixed(1)}</span>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
