import type { Map as MapLibre } from 'maplibre-gl'
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import { getTransformScaleFactor } from '../../../render/transform-scale'
import { analytics } from '../../../utils/analytics'
import s from './map-tool-overlay.module.css'
import { type DistanceUnit, type DrawMode, useMapToolStore } from './map-tool-store'
import {
  convertDistance,
  formatArea,
  formatDistance,
  type LngLat,
  pathLength,
  polygonArea,
} from './measure-math'

// Interactive layer over the output pane. When a map tool is armed, this captures
// clicks, converts them to lng/lat with the live map, and draws the in-progress
// geometry as an SVG overlay so the reading updates as the pointer moves.
//
// Measuring is ephemeral: nothing touches the graph unless the user saves it.
// Drawing hands its features to a GeoEditor node, which is what makes the geometry
// keyframeable afterwards.

interface MapToolOverlayProps {
  mapRef: RefObject<MapLibre | null>
  // Called with the finished features when the user saves a drawing
  onSaveDrawing: (features: GeoJSON.Feature[]) => void
  // Called with the measured path when the user saves a measurement
  onSaveMeasurement: (points: LngLat[], closed: boolean) => void
}

interface ScreenPoint {
  x: number
  y: number
}

interface DrawnShape {
  id: number
  feature: GeoJSON.Feature
}

const MIN_POINTS: Record<DrawMode, number> = { point: 1, line: 2, polygon: 3 }

// Clicks within this many pixels of the previous one are treated as a double-click
// finishing the shape rather than a new vertex.
const DOUBLE_CLICK_SLOP = 6

export function MapToolOverlay({ mapRef, onSaveDrawing, onSaveMeasurement }: MapToolOverlayProps) {
  const activeTool = useMapToolStore(state => state.activeTool)
  const measureMode = useMapToolStore(state => state.measureMode)
  const distanceUnit = useMapToolStore(state => state.distanceUnit)
  const drawMode = useMapToolStore(state => state.drawMode)
  const setActiveTool = useMapToolStore(state => state.setActiveTool)
  const setMeasureMode = useMapToolStore(state => state.setMeasureMode)
  const setDistanceUnit = useMapToolStore(state => state.setDistanceUnit)
  const setDrawMode = useMapToolStore(state => state.setDrawMode)

  const surfaceRef = useRef<HTMLDivElement>(null)
  const [points, setPoints] = useState<LngLat[]>([])
  // Shapes carry a local id purely so React can key them; the id is dropped
  // before the features reach the graph.
  const [shapes, setShapes] = useState<DrawnShape[]>([])
  const nextShapeId = useRef(0)
  const [hover, setHover] = useState<LngLat | null>(null)
  // Bumped on map move to force a re-render, which re-projects every overlay
  // position against the new camera. The value itself is never read.
  const [, bumpProjection] = useState(0)

  const reset = useCallback(() => {
    setPoints([])
    setHover(null)
  }, [])

  // Starting a different tool, or disarming, drops whatever was in progress
  useEffect(() => {
    reset()
    if (!activeTool) setShapes([])
  }, [activeTool, reset])

  // Switching mode mid-shape would produce a geometry the user did not ask for.
  // Adjusted during render rather than in an effect so stale points never paint.
  const modeKey = activeTool === 'measure' ? measureMode : drawMode
  const modeRef = useRef(modeKey)
  if (modeRef.current !== modeKey) {
    modeRef.current = modeKey
    setPoints([])
    setHover(null)
  }

  // Redraw the overlay whenever the camera moves, otherwise the markers detach
  // from the ground features they were placed on.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !activeTool) return
    const bump = () => bumpProjection(v => v + 1)
    map.on('move', bump)
    map.on('zoom', bump)
    return () => {
      map.off('move', bump)
      map.off('zoom', bump)
    }
  }, [mapRef, activeTool])

  const toLngLat = useCallback(
    (event: { clientX: number; clientY: number }): LngLat | null => {
      const map = mapRef.current
      const surface = surfaceRef.current
      if (!map || !surface) return null
      const rect = surface.getBoundingClientRect()
      const scale = getTransformScaleFactor(surface)
      const x = (event.clientX - rect.left) / scale.x
      const y = (event.clientY - rect.top) / scale.y
      const { lng, lat } = map.unproject([x, y])
      return { lng, lat }
    },
    [mapRef]
  )

  // Not memoized: it reads the live camera, so it must be recreated on every
  // render (the map move handler above forces those renders).
  const toScreen = (point: LngLat): ScreenPoint | null => {
    const map = mapRef.current
    if (!map) return null
    const projected = map.project([point.lng, point.lat])
    return { x: projected.x, y: projected.y }
  }

  const finishDrawnShape = useCallback(
    (collected: LngLat[]) => {
      if (collected.length < MIN_POINTS[drawMode]) return false
      const coordinates = collected.map(p => [p.lng, p.lat])
      let geometry: GeoJSON.Geometry
      if (drawMode === 'point') {
        geometry = { type: 'Point', coordinates: coordinates[0] }
      } else if (drawMode === 'line') {
        geometry = { type: 'LineString', coordinates }
      } else {
        geometry = { type: 'Polygon', coordinates: [[...coordinates, coordinates[0]]] }
      }
      const id = nextShapeId.current++
      setShapes(prev => [...prev, { id, feature: { type: 'Feature', geometry, properties: {} } }])
      reset()
      return true
    },
    [drawMode, reset]
  )

  const lastClickRef = useRef<ScreenPoint | null>(null)

  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      const next = toLngLat(event)
      if (!next) return

      // A second click in the same spot finishes the shape. maplibre swallows
      // dblclick over the canvas, so this is detected by proximity instead.
      const last = lastClickRef.current
      const isRepeat =
        last &&
        Math.abs(last.x - event.clientX) < DOUBLE_CLICK_SLOP &&
        Math.abs(last.y - event.clientY) < DOUBLE_CLICK_SLOP
      lastClickRef.current = { x: event.clientX, y: event.clientY }

      if (isRepeat && activeTool === 'draw' && drawMode !== 'point') {
        finishDrawnShape(points)
        return
      }

      if (activeTool === 'draw' && drawMode === 'point') {
        finishDrawnShape([next])
        return
      }

      setPoints(prev => [...prev, next])
    },
    [toLngLat, activeTool, drawMode, points, finishDrawnShape]
  )

  const handleMove = useCallback(
    (event: React.MouseEvent) => {
      if (points.length === 0) {
        setHover(null)
        return
      }
      setHover(toLngLat(event))
    },
    [points.length, toLngLat]
  )

  const undoPoint = useCallback(() => {
    setPoints(prev => prev.slice(0, -1))
  }, [])

  // Escape cancels the shape in progress, then disarms the tool
  useEffect(() => {
    if (!activeTool) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (points.length > 0) reset()
        else setActiveTool(null)
      }
      if (event.key === 'Enter' && activeTool === 'draw') finishDrawnShape(points)
      if ((event.key === 'Backspace' || event.key === 'Delete') && points.length > 0) {
        event.preventDefault()
        undoPoint()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeTool, points, reset, setActiveTool, finishDrawnShape, undoPoint])

  if (!activeTool) return null

  // Measuring an area closes the ring visually as soon as it is valid
  const closeShape =
    (activeTool === 'measure' && measureMode === 'area' && points.length >= 3) ||
    (activeTool === 'draw' && drawMode === 'polygon' && points.length >= 3)

  const previewPoints = hover ? [...points, hover] : points
  const screenPoints = previewPoints.map(toScreen).filter((p): p is ScreenPoint => p !== null)
  const placedVertices = points
    .map(point => ({ key: `${point.lng},${point.lat}`, screen: toScreen(point) }))
    .filter((v): v is { key: string; screen: ScreenPoint } => v.screen !== null)
  const polylinePoints = (closeShape ? [...screenPoints, screenPoints[0]] : screenPoints)
    .filter(Boolean)
    .map(p => `${p.x},${p.y}`)
    .join(' ')

  const savedShapes = shapes
    .map(({ id, feature }) => {
      const geometry = feature.geometry
      const ring =
        geometry.type === 'Polygon'
          ? (geometry.coordinates[0] as [number, number][])
          : geometry.type === 'LineString'
            ? (geometry.coordinates as [number, number][])
            : geometry.type === 'Point'
              ? [geometry.coordinates as [number, number]]
              : []
      return {
        id,
        isPolygon: geometry.type === 'Polygon',
        isPoint: geometry.type === 'Point',
        vertices: ring
          .map(([lng, lat]) => ({ key: `${lng},${lat}`, screen: toScreen({ lng, lat }) }))
          .filter((v): v is { key: string; screen: ScreenPoint } => v.screen !== null),
      }
    })
    .filter(shape => shape.vertices.length > 0)

  const measuredKm = measureMode === 'area' ? polygonArea(previewPoints) : pathLength(previewPoints)
  const readout =
    measureMode === 'area'
      ? formatArea(measuredKm)
      : formatDistance(convertDistance(measuredKm, distanceUnit), distanceUnit)
  const enoughToMeasure = measureMode === 'area' ? points.length >= 3 : points.length >= 2

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: transparent click surface for map picking, keyboard handled by the window listener above */}
      <div
        ref={surfaceRef}
        className={s.surface}
        onClick={handleClick}
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
      >
        <svg className={s.canvas} aria-hidden="true">
          {savedShapes.map(shape => {
            const path = shape.vertices.map(v => `${v.screen.x},${v.screen.y}`).join(' ')
            return (
              <g key={shape.id}>
                {shape.isPolygon && <polygon className={s.savedFill} points={path} />}
                {!shape.isPoint && <polyline className={s.savedStroke} points={path} />}
                {shape.vertices.map(v => (
                  <circle
                    key={v.key}
                    className={s.savedVertex}
                    cx={v.screen.x}
                    cy={v.screen.y}
                    r={3}
                  />
                ))}
              </g>
            )
          })}

          {closeShape && screenPoints.length >= 3 && (
            <polygon
              className={s.activeFill}
              points={screenPoints.map(p => `${p.x},${p.y}`).join(' ')}
            />
          )}
          {screenPoints.length >= 2 && (
            <polyline className={s.activeStroke} points={polylinePoints} />
          )}
          {placedVertices.map(v => (
            <circle key={v.key} className={s.vertex} cx={v.screen.x} cy={v.screen.y} r={5} />
          ))}
        </svg>
      </div>

      <div className={s.panel}>
        <div className={s.panelHeader}>
          <i className={activeTool === 'measure' ? 'pi pi-arrows-h' : 'pi pi-pencil'} />
          <span className={s.panelTitle}>{activeTool === 'measure' ? 'Measure' : 'Draw'}</span>
          <button
            type="button"
            className={s.panelClose}
            onClick={() => setActiveTool(null)}
            aria-label="Close tool"
          >
            <i className="pi pi-times" />
          </button>
        </div>

        {activeTool === 'measure' ? (
          <>
            <div className={s.segmented}>
              <button
                type="button"
                className={measureMode === 'distance' ? s.segmentActive : s.segment}
                onClick={() => setMeasureMode('distance')}
              >
                <i className="pi pi-arrows-h" /> Distance
              </button>
              <button
                type="button"
                className={measureMode === 'area' ? s.segmentActive : s.segment}
                onClick={() => setMeasureMode('area')}
              >
                <i className="pi pi-stop" /> Area
              </button>
            </div>

            {measureMode === 'distance' && (
              <select
                className={s.select}
                value={distanceUnit}
                onChange={event => setDistanceUnit(event.target.value as DistanceUnit)}
              >
                <option value="kilometers">Kilometers</option>
                <option value="miles">Miles</option>
                <option value="meters">Meters</option>
                <option value="nauticalmiles">Nautical miles</option>
              </select>
            )}

            <div className={s.readout}>
              {enoughToMeasure ? (
                <span className={s.readoutValue}>{readout}</span>
              ) : (
                <span className={s.readoutHint}>
                  Click the map to place {measureMode === 'area' ? '3 or more' : '2 or more'} points
                </span>
              )}
            </div>
          </>
        ) : (
          <>
            <div className={s.segmented}>
              <button
                type="button"
                className={drawMode === 'point' ? s.segmentActive : s.segment}
                onClick={() => setDrawMode('point')}
                title="Point"
              >
                <i className="pi pi-map-marker" />
              </button>
              <button
                type="button"
                className={drawMode === 'line' ? s.segmentActive : s.segment}
                onClick={() => setDrawMode('line')}
                title="Line"
              >
                <i className="pi pi-minus" />
              </button>
              <button
                type="button"
                className={drawMode === 'polygon' ? s.segmentActive : s.segment}
                onClick={() => setDrawMode('polygon')}
                title="Polygon"
              >
                <i className="pi pi-stop" />
              </button>
            </div>

            <div className={s.readout}>
              <span className={s.readoutValue}>
                {shapes.length} shape{shapes.length === 1 ? '' : 's'}
              </span>
              {points.length > 0 && (
                <span className={s.readoutHint}>
                  {points.length} point{points.length === 1 ? '' : 's'}
                  {points.length < MIN_POINTS[drawMode]
                    ? ` (need ${MIN_POINTS[drawMode]})`
                    : ' - click again to finish'}
                </span>
              )}
            </div>
          </>
        )}

        <div className={s.actions}>
          {points.length > 0 && (
            <button type="button" className={s.action} onClick={undoPoint}>
              <i className="pi pi-undo" /> Undo
            </button>
          )}
          {activeTool === 'draw' && points.length >= MIN_POINTS[drawMode] && (
            <button type="button" className={s.action} onClick={() => finishDrawnShape(points)}>
              <i className="pi pi-check" /> Finish
            </button>
          )}
          {(points.length > 0 || shapes.length > 0) && (
            <button
              type="button"
              className={s.action}
              onClick={() => {
                reset()
                setShapes([])
              }}
            >
              <i className="pi pi-trash" /> Clear
            </button>
          )}
          {activeTool === 'measure' && enoughToMeasure && (
            <button
              type="button"
              className={s.primaryAction}
              onClick={() => {
                onSaveMeasurement(points, measureMode === 'area')
                analytics.track('measure_saved_to_graph', { mode: measureMode })
                setActiveTool(null)
              }}
            >
              Add to graph
            </button>
          )}
          {activeTool === 'draw' && shapes.length > 0 && (
            <button
              type="button"
              className={s.primaryAction}
              onClick={() => {
                onSaveDrawing(shapes.map(shape => shape.feature))
                analytics.track('draw_saved_to_graph', { count: shapes.length })
                setActiveTool(null)
              }}
            >
              Add to graph
            </button>
          )}
        </div>
      </div>
    </>
  )
}
