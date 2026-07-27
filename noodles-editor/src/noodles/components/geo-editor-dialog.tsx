import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import { useCallback, useState } from 'react'
import ReactMapGL, { Layer, Source } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import { CARTO_DARK } from '../../utils/map-styles'
import type { IOperator, Operator } from '../operators'
import s from './geo-editor-dialog.module.css'

type DrawMode = 'point' | 'line' | 'polygon' | 'select'

interface Feature {
  type: 'Feature'
  geometry: {
    type: string
    coordinates: number[] | number[][] | number[][][]
  }
  properties: Record<string, unknown>
}

interface GeoEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  operator: Operator<IOperator>
}

function parseGeoJson(value: string): Feature[] {
  try {
    const parsed = JSON.parse(value)
    if (parsed.type === 'FeatureCollection') return parsed.features ?? []
    if (parsed.type === 'Feature') return [parsed]
    return []
  } catch {
    return []
  }
}

export function GeoEditorDialog({ open, onOpenChange, operator }: GeoEditorDialogProps) {
  const [drawMode, setDrawMode] = useState<DrawMode>('polygon')
  const [currentPoints, setCurrentPoints] = useState<[number, number][]>([])
  const [features, setFeatures] = useState<Feature[]>(() =>
    parseGeoJson(String(operator.inputs.geojson?.value ?? ''))
  )

  const handleMapClick = useCallback(
    (e: { lngLat: { lng: number; lat: number } }) => {
      const { lng, lat } = e.lngLat
      const point: [number, number] = [lng, lat]

      if (drawMode === 'point') {
        const newFeature: Feature = {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: point },
          properties: {},
        }
        setFeatures(prev => [...prev, newFeature])
      } else {
        setCurrentPoints(prev => [...prev, point])
      }
    },
    [drawMode]
  )

  const finishShape = useCallback(() => {
    if (currentPoints.length < 2) return

    let newFeature: Feature
    if (drawMode === 'line') {
      newFeature = {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: currentPoints },
        properties: {},
      }
    } else {
      const closed = [...currentPoints, currentPoints[0]]
      newFeature = {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [closed] },
        properties: {},
      }
    }
    setFeatures(prev => [...prev, newFeature])
    setCurrentPoints([])
  }, [drawMode, currentPoints])

  const removeLastFeature = useCallback(() => {
    setFeatures(prev => prev.slice(0, -1))
  }, [])

  const clearAll = useCallback(() => {
    setFeatures([])
    setCurrentPoints([])
  }, [])

  const save = useCallback(() => {
    const fc = { type: 'FeatureCollection', features }
    operator.inputs.geojson?.setValue(JSON.stringify(fc, null, 2))
    onOpenChange(false)
  }, [features, operator, onOpenChange])

  const geojsonData: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: [
      ...(features as GeoJSON.Feature[]),
      ...(currentPoints.length > 0
        ? [
            {
              type: 'Feature' as const,
              geometry: {
                type: 'LineString' as const,
                coordinates: currentPoints,
              },
              properties: { _drawing: true },
            },
          ]
        : []),
    ],
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={s.overlay} />
        <Dialog.Content className={s.content}>
          <div className={s.header}>
            <Dialog.Title className={s.title}>GeoEditor</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" className={s.closeButton} aria-label="Close">
                <Cross2Icon />
              </button>
            </Dialog.Close>
          </div>

          <div className={s.toolbar}>
            <button
              type="button"
              className={`${s.toolBtn} ${drawMode === 'point' ? s.toolActive : ''}`}
              onClick={() => setDrawMode('point')}
              title="Draw Point"
            >
              <i className="pi pi-map-marker" />
            </button>
            <button
              type="button"
              className={`${s.toolBtn} ${drawMode === 'line' ? s.toolActive : ''}`}
              onClick={() => setDrawMode('line')}
              title="Draw Line"
            >
              <i className="pi pi-minus" />
            </button>
            <button
              type="button"
              className={`${s.toolBtn} ${drawMode === 'polygon' ? s.toolActive : ''}`}
              onClick={() => setDrawMode('polygon')}
              title="Draw Polygon"
            >
              <i className="pi pi-stop" />
            </button>
            <div className={s.toolDivider} />
            {currentPoints.length >= 2 && (
              <button
                type="button"
                className={s.toolBtn}
                onClick={finishShape}
                title="Finish Shape"
              >
                <i className="pi pi-check" />
              </button>
            )}
            <button
              type="button"
              className={s.toolBtn}
              onClick={removeLastFeature}
              disabled={features.length === 0}
              title="Remove Last"
            >
              <i className="pi pi-undo" />
            </button>
            <button type="button" className={s.toolBtn} onClick={clearAll} title="Clear All">
              <i className="pi pi-trash" />
            </button>
          </div>

          <div className={s.mapContainer}>
            <ReactMapGL
              initialViewState={{ latitude: 40, longitude: -74, zoom: 3 }}
              style={{ width: '100%', height: '100%' }}
              mapStyle={CARTO_DARK}
              onClick={handleMapClick}
              cursor={drawMode === 'select' ? 'default' : 'crosshair'}
            >
              <Source id="drawn-features" type="geojson" data={geojsonData}>
                <Layer
                  id="drawn-fills"
                  type="fill"
                  paint={{ 'fill-color': '#3b82f6', 'fill-opacity': 0.3 }}
                  filter={['==', '$type', 'Polygon']}
                />
                <Layer
                  id="drawn-lines"
                  type="line"
                  paint={{ 'line-color': '#3b82f6', 'line-width': 2 }}
                  filter={['in', '$type', 'LineString', 'Polygon']}
                />
                <Layer
                  id="drawn-points"
                  type="circle"
                  paint={{
                    'circle-radius': 6,
                    'circle-color': '#3b82f6',
                    'circle-stroke-color': '#fff',
                    'circle-stroke-width': 2,
                  }}
                  filter={['==', '$type', 'Point']}
                />
              </Source>
            </ReactMapGL>
          </div>

          <div className={s.footer}>
            <span className={s.featureCount}>
              {features.length} feature{features.length !== 1 ? 's' : ''}
              {currentPoints.length > 0 && ` | Drawing: ${currentPoints.length} points`}
            </span>
            <div className={s.footerActions}>
              <Dialog.Close asChild>
                <button type="button" className={s.cancelBtn}>
                  Cancel
                </button>
              </Dialog.Close>
              <button type="button" className={s.saveBtn} onClick={save}>
                Save
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
