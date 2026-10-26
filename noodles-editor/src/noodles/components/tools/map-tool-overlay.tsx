import type { Map as MapLibre } from 'maplibre-gl'
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { analytics } from '../../../utils/analytics'
import {
  buildShape,
  closeIntoPolygon,
  type DrawFollowUp,
  describeShape,
  followUpsFor,
  insertVertex,
  moveVertex,
  openIntoLine,
  removeVertex,
  type ShapeKind,
  segmentMidpoints,
  shapeKind,
  toFeatureCollection,
  vertexPositions,
} from './draw-shapes'
import type { EditTarget } from './edit-target'
import s from './map-tool-overlay.module.css'
import { type DistanceUnit, useMapToolStore } from './map-tool-store'
import {
  convertDistance,
  formatArea,
  formatDistance,
  type LngLat,
  pathLength,
  polygonArea,
} from './measure-math'
import { clientToMapPoint, mapPointToOverlay } from './overlay-coords'

// Interactive layer over the output pane. When a map tool is armed, this captures
// clicks, converts them to lng/lat with the live map, and draws the in-progress
// geometry as an SVG overlay so the reading updates as the pointer moves.
//
// Measuring is ephemeral: nothing touches the graph unless the user saves it.
// Drawing hands its features to a GeoEditor node, which is what makes the geometry
// keyframeable afterwards. Editing loads an existing GeoEditor or Point node's
// geometry into the same tool and writes it back on save.

// An existing node's geometry, loaded into the tool for editing
export interface EditSession extends EditTarget {
  // Node name shown in the panel
  label: string
  features: GeoJSON.Feature[]
}

interface MapToolOverlayProps {
  mapRef: RefObject<MapLibre | null>
  // Called with the finished features when the user saves a drawing
  onSaveDrawing: (features: GeoJSON.Feature[]) => void
  // Called with the measured path when the user saves a measurement
  onSaveMeasurement: (points: LngLat[], closed: boolean) => void
  // Called when the user picks a follow-up (Clip, Buffer, ...) for the drawing
  onSendDrawing: (followUp: DrawFollowUp, features: GeoJSON.Feature[]) => void
  // The map is drawn behind the node graph, which would take every click. The surface
  // then moves out to the document and is pinned over the map canvas, above the graph.
  detached?: boolean
  // Set while editing an existing node rather than drawing new shapes
  editSession?: EditSession | null
  // Writes edited shapes back to the node; returns false if nothing could be written
  onSaveEdits?: (target: EditTarget, features: GeoJSON.Feature[]) => boolean
}

interface ScreenPoint {
  x: number
  y: number
}

interface DrawnShape {
  id: number
  feature: GeoJSON.Feature
}

const SHAPE_ICONS: Record<ShapeKind, string> = {
  point: 'pi pi-map-marker',
  line: 'pi pi-minus',
  polygon: 'pi pi-stop',
}

// Clicks within this many pixels of the previous one are treated as a double-click
// finishing the shape rather than a new vertex.
const DOUBLE_CLICK_SLOP = 6

// How close, in screen pixels, the pointer must be to the first vertex to close the
// shape on click. Larger than the vertex dot so it is easy to hit.
const CLOSE_SLOP = 10

// How close, in screen pixels, the pointer must be to a vertex or midpoint handle of a
// finished shape to grab it
const HANDLE_SLOP = 8

type Handle =
  | { type: 'vertex'; shapeId: number; index: number }
  | { type: 'midpoint'; shapeId: number; insertAt: number; position: GeoJSON.Position }

const EDIT_HINT = 'Drag a point to move it, drag a midpoint to add one, Alt-click to remove one'

function drawHint(mode: ShapeKind, count: number): string {
  if (mode === 'point') return 'Click the map to drop a point'
  if (count === 0) return `Click the map to start a ${mode}`
  if (mode === 'polygon') {
    if (count < 3) return `Add ${3 - count} more point${3 - count === 1 ? '' : 's'}`
    return 'Click the first point or press Enter to close the shape'
  }
  if (count < 2) return 'Click to add the next point'
  if (count < 3) return 'Double-click or press Enter to finish the line'
  return 'Double-click or press Enter to finish, or click the first point to make a polygon'
}

export function MapToolOverlay({
  mapRef,
  onSaveDrawing,
  onSaveMeasurement,
  onSendDrawing,
  detached = false,
  editSession = null,
  onSaveEdits,
}: MapToolOverlayProps) {
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
  // Pointer is over the first vertex, so a click closes the shape
  const [overFirst, setOverFirst] = useState(false)
  // Shape whose row in the panel is hovered, drawn emphasized on the map
  const [highlightId, setHighlightId] = useState<number | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  // Handle under the pointer, for the cursor
  const [hoverHandle, setHoverHandle] = useState<Handle['type'] | null>(null)
  // Set while a vertex is dragged, so the click that ends the drag is ignored
  const suppressClickRef = useRef(false)
  // Bumped on map move to force a re-render, which re-projects every overlay
  // position against the new camera. The value itself is never read.
  const [, bumpProjection] = useState(0)

  const reset = useCallback(() => {
    setPoints([])
    setHover(null)
    setOverFirst(false)
  }, [])

  // Starting a different tool, or disarming, drops whatever was in progress
  useEffect(() => {
    reset()
    if (!activeTool) setShapes([])
  }, [activeTool, reset])

  // Editing starts from the node's own geometry. Runs after the reset above, so the
  // loaded shapes are not cleared again.
  // Any unfinished drawing is dropped too, so it can't be finished into the new node.
  useEffect(() => {
    reset()
    if (!editSession) return
    setShapes(editSession.features.map(feature => ({ id: nextShapeId.current++, feature })))
  }, [editSession, reset])

  // Switching mode mid-shape would produce a geometry the user did not ask for.
  // Adjusted during render rather than in an effect so stale points never paint.
  const modeKey = activeTool === 'measure' ? measureMode : drawMode
  const modeRef = useRef(modeKey)
  if (modeRef.current !== modeKey) {
    modeRef.current = modeKey
    setPoints([])
    setHover(null)
    setOverFirst(false)
  }

  // A detached surface is pinned to the canvas rect, so follow the canvas when the
  // pane it sits in is resized or the window changes size. The canvas's own layout
  // size can stay put while TransformScale shrinks it with a CSS transform, so every
  // ancestor is watched too: a pane resize always changes one of their sizes.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !activeTool || !detached) return
    const bump = () => bumpProjection(v => v + 1)
    const observer = new ResizeObserver(bump)
    for (let el: Element | null = map.getCanvas(); el && el !== document.body; ) {
      observer.observe(el)
      el = el.parentElement
    }
    window.addEventListener('resize', bump)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', bump)
    }
  }, [mapRef, activeTool, detached])

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

  // maplibre projects against its own canvas, which is not the same box as this
  // overlay: the map lives inside a scaled wrapper and, in fixed display mode, is
  // letterboxed inside the pane at a fixed resolution. Everything below converts
  // through the canvas rect so clicks land on the pixel the user pointed at
  // regardless of pane size or split-view layout.
  const canvasRect = useCallback((): DOMRect | null => {
    const map = mapRef.current
    if (!map) return null
    return map.getCanvas().getBoundingClientRect()
  }, [mapRef])

  const toLngLat = useCallback(
    (event: { clientX: number; clientY: number }): LngLat | null => {
      const map = mapRef.current
      const rect = canvasRect()
      if (!map || !rect) return null
      const canvas = map.getCanvas()
      const mapPoint = clientToMapPoint({ x: event.clientX, y: event.clientY }, rect, {
        width: canvas.clientWidth,
        height: canvas.clientHeight,
      })
      if (!mapPoint) return null
      const { lng, lat } = map.unproject([mapPoint.x, mapPoint.y])
      return { lng, lat }
    },
    [mapRef, canvasRect]
  )

  // Not memoized: it reads the live camera, so it must be recreated on every
  // render (the map move handler above forces those renders).
  const toScreen = (point: LngLat): ScreenPoint | null => {
    const map = mapRef.current
    const surface = surfaceRef.current
    const rect = canvasRect()
    if (!map || !surface || !rect) return null
    const canvas = map.getCanvas()
    const projected = map.project([point.lng, point.lat])
    return mapPointToOverlay(
      projected,
      rect,
      { width: canvas.clientWidth, height: canvas.clientHeight },
      surface.getBoundingClientRect(),
      { width: surface.offsetWidth, height: surface.offsetHeight }
    )
  }

  // A position in client pixels, for hit-testing handles. Reads the live camera.
  const toClient = (position: GeoJSON.Position): ScreenPoint | null => {
    const map = mapRef.current
    const rect = canvasRect()
    if (!map || !rect) return null
    const canvas = map.getCanvas()
    const projected = map.project([position[0], position[1]])
    return {
      x: rect.left + projected.x * (canvas.clientWidth ? rect.width / canvas.clientWidth : 1),
      y: rect.top + projected.y * (canvas.clientHeight ? rect.height / canvas.clientHeight : 1),
    }
  }

  // The finished-shape handle under the pointer. Vertices win over midpoints, and later
  // shapes over earlier ones, matching what is drawn on top. Only while nothing is
  // being drawn, so placing a new vertex near an old one still works.
  const findHandle = (event: { clientX: number; clientY: number }): Handle | null => {
    if (activeTool !== 'draw' || points.length > 0) return null
    const near = (position: GeoJSON.Position) => {
      const client = toClient(position)
      return (
        client !== null &&
        Math.hypot(event.clientX - client.x, event.clientY - client.y) <= HANDLE_SLOP
      )
    }
    for (let i = shapes.length - 1; i >= 0; i--) {
      const { id, feature } = shapes[i]
      const index = vertexPositions(feature).findIndex(near)
      if (index !== -1) return { type: 'vertex', shapeId: id, index }
    }
    for (let i = shapes.length - 1; i >= 0; i--) {
      const { id, feature } = shapes[i]
      const midpoint = segmentMidpoints(feature).find(m => near(m.position))
      if (midpoint) return { type: 'midpoint', shapeId: id, ...midpoint }
    }
    return null
  }

  const updateShape = (id: number, update: (feature: GeoJSON.Feature) => GeoJSON.Feature) => {
    setShapes(prev =>
      prev.map(shape => (shape.id === id ? { ...shape, feature: update(shape.feature) } : shape))
    )
  }

  // Grabbing a handle starts a drag that follows the pointer until release. A midpoint
  // first becomes a real vertex, which is then dragged like any other.
  const handleMouseDown = (event: React.MouseEvent) => {
    if (event.button !== 0) return
    const handle = findHandle(event)
    if (!handle) return
    event.preventDefault()
    // The release ends the gesture wherever it happens. A click on the surface follows
    // a release there in the same task, so clearing after it skips only that one click.
    suppressClickRef.current = true
    const endGesture = () => {
      window.removeEventListener('mouseup', endGesture)
      setTimeout(() => {
        suppressClickRef.current = false
      }, 0)
    }
    window.addEventListener('mouseup', endGesture)

    if (handle.type === 'vertex' && event.altKey) {
      const shape = shapes.find(candidate => candidate.id === handle.shapeId)
      const next = shape && removeVertex(shape.feature, handle.index)
      if (next) {
        updateShape(handle.shapeId, () => next)
        analytics.track('draw_shape_edited', { action: 'remove_vertex' })
      }
      return
    }

    const index = handle.type === 'vertex' ? handle.index : handle.insertAt
    if (handle.type === 'midpoint') {
      updateShape(handle.shapeId, feature =>
        insertVertex(feature, handle.insertAt, handle.position)
      )
    }

    let moved = false
    const onMove = (moveEvent: MouseEvent) => {
      const next = toLngLat(moveEvent)
      if (!next) return
      moved = true
      updateShape(handle.shapeId, feature => moveVertex(feature, index, [next.lng, next.lat]))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      if (moved || handle.type === 'midpoint') {
        analytics.track('draw_shape_edited', {
          action: handle.type === 'midpoint' ? 'add_vertex' : 'move_vertex',
        })
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // `kind` differs from the armed mode when a line is closed into a polygon
  const finishDrawnShape = useCallback(
    (collected: LngLat[], kind: ShapeKind = drawMode) => {
      const feature = buildShape(collected, kind)
      if (!feature) return false
      const id = nextShapeId.current++
      setShapes(prev => [...prev, { id, feature }])
      reset()
      return true
    },
    [drawMode, reset]
  )

  const canCloseOnFirst = activeTool === 'draw' && drawMode !== 'point' && points.length >= 3

  // Whether a client-space pointer is over the first placed vertex. Compared in client
  // pixels, so it holds however the map canvas is scaled inside the pane.
  const isOverFirstVertex = useCallback(
    (event: { clientX: number; clientY: number }): boolean => {
      const map = mapRef.current
      const rect = canvasRect()
      if (!canCloseOnFirst || !map || !rect) return false
      const canvas = map.getCanvas()
      const projected = map.project([points[0].lng, points[0].lat])
      const x = rect.left + projected.x * (canvas.clientWidth ? rect.width / canvas.clientWidth : 1)
      const y =
        rect.top + projected.y * (canvas.clientHeight ? rect.height / canvas.clientHeight : 1)
      return Math.hypot(event.clientX - x, event.clientY - y) <= CLOSE_SLOP
    },
    [mapRef, canvasRect, canCloseOnFirst, points]
  )

  const lastClickRef = useRef<ScreenPoint | null>(null)

  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false
        return
      }
      const next = toLngLat(event)
      if (!next) return

      // A Point node holds exactly one point, so a click moves it there
      if (editSession?.kind === 'point') {
        setShapes(prev => {
          const feature = buildShape([next], 'point') as GeoJSON.Feature
          return [{ id: prev[0]?.id ?? nextShapeId.current++, feature }]
        })
        analytics.track('draw_shape_edited', { action: 'move_point' })
        return
      }

      // A second click in the same spot finishes the shape. maplibre swallows
      // dblclick over the canvas, so this is detected by proximity instead.
      const last = lastClickRef.current
      const isRepeat =
        last &&
        Math.abs(last.x - event.clientX) < DOUBLE_CLICK_SLOP &&
        Math.abs(last.y - event.clientY) < DOUBLE_CLICK_SLOP
      lastClickRef.current = { x: event.clientX, y: event.clientY }

      // Clicking the first vertex closes the ring, whichever of line or polygon is armed
      if (isOverFirstVertex(event)) {
        finishDrawnShape(points, 'polygon')
        lastClickRef.current = null
        return
      }

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
    [toLngLat, activeTool, drawMode, points, finishDrawnShape, isOverFirstVertex, editSession]
  )

  // Not memoized: findHandle reads the live camera
  const handleMove = (event: React.MouseEvent) => {
    if (points.length === 0) {
      setHover(null)
      const handle = findHandle(event)?.type ?? null
      if (handle !== hoverHandle) setHoverHandle(handle)
      return
    }
    const snap = isOverFirstVertex(event)
    setOverFirst(snap)
    setHover(snap ? points[0] : toLngLat(event))
  }

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

  // Whether the edited shapes differ from what the node holds, so Save means something.
  // Memoized because it stringifies every feature and the overlay re-renders on each
  // pointer move.
  const editsChanged = useMemo(() => {
    if (!editSession) return false
    const current = shapes.map(shape => shape.feature)
    return JSON.stringify(current) !== JSON.stringify(editSession.features)
  }, [shapes, editSession])

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

  // Features with no geometry stay in `shapes` so saving keeps them, but draw nothing
  const savedShapes = shapes
    .flatMap(({ id, feature }) => {
      const geometry = feature.geometry
      if (!geometry) return []
      const ring =
        geometry.type === 'Polygon'
          ? (geometry.coordinates[0] as [number, number][])
          : geometry.type === 'LineString'
            ? (geometry.coordinates as [number, number][])
            : geometry.type === 'Point'
              ? [geometry.coordinates as [number, number]]
              : []
      return [
        {
          id,
          isPolygon: geometry.type === 'Polygon',
          isPoint: geometry.type === 'Point',
          // A ring repeats its first vertex at the end, so the index keeps keys unique
          vertices: ring
            .map(([lng, lat], i) => ({ key: `${i}:${lng},${lat}`, screen: toScreen({ lng, lat }) }))
            .filter((v): v is { key: string; screen: ScreenPoint } => v.screen !== null),
        },
      ]
    })
    .filter(shape => shape.vertices.length > 0)

  const measuredKm = measureMode === 'area' ? polygonArea(previewPoints) : pathLength(previewPoints)
  const readout =
    measureMode === 'area'
      ? formatArea(measuredKm)
      : formatDistance(convertDistance(measuredKm, distanceUnit), distanceUnit)
  const enoughToMeasure = measureMode === 'area' ? points.length >= 3 : points.length >= 2

  // The map can render at a fixed resolution and be CSS-scaled to fit the pane, and this
  // overlay scales with it. Sizes are multiplied by `unit` so dots and strokes keep
  // their on-screen size instead of shrinking with the map.
  const surface = surfaceRef.current
  const surfaceWidth = surface?.getBoundingClientRect().width
  const unit = surface && surfaceWidth ? surface.offsetWidth / surfaceWidth : 1

  const firstVertex = canCloseOnFirst ? placedVertices[0] : undefined

  // Grab handles on finished shapes, hidden while a new shape is being drawn
  const showHandles = activeTool === 'draw' && points.length === 0
  const handles = showHandles
    ? shapes.flatMap(({ id, feature }) => {
        const toHandle = (position: GeoJSON.Position, key: string, midpoint: boolean) => {
          const screen = toScreen({ lng: position[0], lat: position[1] })
          return screen ? [{ key: `${id}:${key}`, screen, midpoint }] : []
        }
        return [
          ...segmentMidpoints(feature).flatMap(m => toHandle(m.position, `m${m.insertAt}`, true)),
          ...vertexPositions(feature).flatMap((p, i) => toHandle(p, `v${i}`, false)),
        ]
      })
    : []
  const features = shapes.map(shape => shape.feature)
  const followUps = followUpsFor(features)

  const replaceShape = (
    id: number,
    next: GeoJSON.Feature | null,
    action: 'close_polygon' | 'to_outline'
  ) => {
    if (!next) return
    setShapes(prev => prev.map(shape => (shape.id === id ? { ...shape, feature: next } : shape)))
    analytics.track('draw_shape_edited', { action })
  }

  const removeShape = (id: number, kind: ShapeKind | null) => {
    setShapes(prev => prev.filter(shape => shape.id !== id))
    setHighlightId(current => (current === id ? null : current))
    analytics.track('draw_shape_edited', { action: 'delete', kind })
  }

  const showCopyState = (state: 'copied' | 'failed') => {
    setCopyState(state)
    setTimeout(() => setCopyState('idle'), 2000)
  }

  const copyGeoJson = () => {
    const text = JSON.stringify(toFeatureCollection(features), null, 2)
    if (!navigator.clipboard) {
      showCopyState('failed')
      return
    }
    navigator.clipboard
      .writeText(text)
      .then(() => {
        showCopyState('copied')
        analytics.track('draw_copied_geojson', { count: features.length })
      })
      .catch(() => showCopyState('failed'))
  }

  const pinnedRect = detached ? canvasRect() : null
  const surfaceStyle = pinnedRect
    ? {
        left: pinnedRect.left,
        top: pinnedRect.top,
        width: pinnedRect.width,
        height: pinnedRect.height,
      }
    : undefined

  const surfaceElement = (
    // biome-ignore lint/a11y/noStaticElementInteractions: transparent click surface for map picking, keyboard handled by the window listener above
    <div
      ref={surfaceRef}
      className={detached ? s.surfaceDetached : s.surface}
      style={{ ...surfaceStyle, cursor: hoverHandle ? 'move' : undefined }}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      onMouseMove={handleMove}
      onMouseLeave={() => setHover(null)}
    >
      <svg
        className={s.canvas}
        aria-hidden="true"
        style={{ '--unit': unit } as React.CSSProperties}
      >
        {savedShapes.map(shape => {
          const path = shape.vertices.map(v => `${v.screen.x},${v.screen.y}`).join(' ')
          const highlighted = shape.id === highlightId
          return (
            <g key={shape.id} className={highlighted ? s.savedHighlight : undefined}>
              {shape.isPolygon && <polygon className={s.savedFill} points={path} />}
              {!shape.isPoint && <polyline className={s.savedStroke} points={path} />}
              {!showHandles &&
                shape.vertices.map(v => (
                  <circle
                    key={v.key}
                    className={s.savedVertex}
                    cx={v.screen.x}
                    cy={v.screen.y}
                    r={(shape.isPoint ? 5 : 3) * unit}
                  />
                ))}
            </g>
          )
        })}
        {handles.map(handle => (
          <circle
            key={handle.key}
            className={handle.midpoint ? s.midpointHandle : s.vertexHandle}
            cx={handle.screen.x}
            cy={handle.screen.y}
            r={(handle.midpoint ? 3 : 5) * unit}
          />
        ))}

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
          <circle key={v.key} className={s.vertex} cx={v.screen.x} cy={v.screen.y} r={5 * unit} />
        ))}
        {/* The first vertex doubles as a close button once the shape can be closed */}
        {firstVertex && (
          <circle
            className={overFirst ? s.closeTargetActive : s.closeTarget}
            cx={firstVertex.screen.x}
            cy={firstVertex.screen.y}
            r={(overFirst ? 10 : 8) * unit}
          />
        )}
      </svg>
    </div>
  )

  return (
    <>
      {detached ? createPortal(surfaceElement, document.body) : surfaceElement}

      {createPortal(
        <div className={s.panel}>
          <div className={s.panelHeader}>
            <i className={activeTool === 'measure' ? 'pi pi-arrows-h' : 'pi pi-pencil'} />
            <span className={s.panelTitle}>
              {activeTool === 'measure'
                ? 'Measure'
                : editSession
                  ? `Editing ${editSession.label}`
                  : 'Draw'}
            </span>
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
                    Click the map to place {measureMode === 'area' ? '3 or more' : '2 or more'}{' '}
                    points
                  </span>
                )}
              </div>
            </>
          ) : (
            <>
              {editSession?.kind !== 'point' && (
                <div className={s.segmented}>
                  <button
                    type="button"
                    className={drawMode === 'point' ? s.segmentActive : s.segment}
                    onClick={() => setDrawMode('point')}
                  >
                    <i className="pi pi-map-marker" /> Point
                  </button>
                  <button
                    type="button"
                    className={drawMode === 'line' ? s.segmentActive : s.segment}
                    onClick={() => setDrawMode('line')}
                  >
                    <i className="pi pi-minus" /> Line
                  </button>
                  <button
                    type="button"
                    className={drawMode === 'polygon' ? s.segmentActive : s.segment}
                    onClick={() => setDrawMode('polygon')}
                  >
                    <i className="pi pi-stop" /> Polygon
                  </button>
                </div>
              )}

              <div className={s.readout}>
                <span className={s.readoutHint}>
                  {editSession?.kind === 'point'
                    ? 'Drag the point or click the map to move it'
                    : drawHint(drawMode, points.length)}
                </span>
                {editSession?.kind !== 'point' && showHandles && shapes.length > 0 && (
                  <span className={s.readoutHint}>{EDIT_HINT}</span>
                )}
              </div>

              {/* Actions for the shape being drawn, labeled for what each will produce */}
              {points.length > 0 && (
                <div className={s.actions}>
                  <button type="button" className={s.action} onClick={undoPoint}>
                    <i className="pi pi-undo" /> Undo
                  </button>
                  <button type="button" className={s.action} onClick={reset}>
                    <i className="pi pi-times" /> Cancel
                  </button>
                  {drawMode === 'line' && points.length >= 2 && (
                    <button
                      type="button"
                      className={s.action}
                      onClick={() => finishDrawnShape(points, 'line')}
                    >
                      <i className="pi pi-check" /> Finish line
                    </button>
                  )}
                  {drawMode !== 'point' && points.length >= 3 && (
                    <button
                      type="button"
                      className={s.action}
                      onClick={() => finishDrawnShape(points, 'polygon')}
                    >
                      <i className="pi pi-stop" />{' '}
                      {drawMode === 'polygon' ? 'Close shape' : 'Close as polygon'}
                    </button>
                  )}
                </div>
              )}

              {shapes.length > 0 && (
                <div className={s.section}>
                  <div className={s.sectionHeader}>
                    <span>
                      {shapes.length} shape{shapes.length === 1 ? '' : 's'}
                    </span>
                    {editSession?.kind !== 'point' && (
                      <button
                        type="button"
                        className={s.linkButton}
                        onClick={() => {
                          analytics.track('draw_shape_edited', {
                            action: 'clear_all',
                            count: shapes.length,
                          })
                          reset()
                          setShapes([])
                        }}
                      >
                        Clear all
                      </button>
                    )}
                  </div>
                  <ul className={s.shapeList}>
                    {shapes.map(shape => {
                      const kind = shapeKind(shape.feature)
                      const asPolygon = kind === 'line' ? closeIntoPolygon(shape.feature) : null
                      return (
                        <li
                          key={shape.id}
                          className={s.shapeRow}
                          onMouseEnter={() => setHighlightId(shape.id)}
                          onMouseLeave={() => setHighlightId(null)}
                        >
                          <i className={kind ? SHAPE_ICONS[kind] : 'pi pi-circle'} />
                          <span className={s.shapeLabel}>{describeShape(shape.feature)}</span>
                          {asPolygon && (
                            <button
                              type="button"
                              className={s.iconButton}
                              onClick={() => replaceShape(shape.id, asPolygon, 'close_polygon')}
                              title="Close into a polygon"
                              aria-label="Close into a polygon"
                            >
                              <i className="pi pi-stop" />
                            </button>
                          )}
                          {kind === 'polygon' && (
                            <button
                              type="button"
                              className={s.iconButton}
                              onClick={() =>
                                replaceShape(shape.id, openIntoLine(shape.feature), 'to_outline')
                              }
                              title="Turn into an outline"
                              aria-label="Turn into an outline"
                            >
                              <i className="pi pi-minus" />
                            </button>
                          )}
                          {editSession?.kind !== 'point' && (
                            <button
                              type="button"
                              className={s.iconButton}
                              onClick={() => removeShape(shape.id, kind)}
                              title="Delete shape"
                              aria-label="Delete shape"
                            >
                              <i className="pi pi-trash" />
                            </button>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}

              {editSession && (
                <div className={s.section}>
                  <button
                    type="button"
                    className={s.primaryAction}
                    disabled={!editsChanged}
                    onClick={() => {
                      const saved = onSaveEdits?.(editSession, features) ?? false
                      if (!saved) return
                      analytics.track('draw_edits_saved', {
                        kind: editSession.kind,
                        count: features.length,
                      })
                      setActiveTool(null)
                    }}
                  >
                    <i className="pi pi-check" /> Save to {editSession.label}
                  </button>
                  <button type="button" className={s.followUp} onClick={() => setActiveTool(null)}>
                    <i className="pi pi-times" /> {editsChanged ? 'Discard changes' : 'Done'}
                  </button>
                </div>
              )}

              {!editSession && shapes.length > 0 && (
                <div className={s.section}>
                  <div className={s.sectionHeader}>
                    <span>Use drawing</span>
                  </div>
                  <button
                    type="button"
                    className={s.primaryAction}
                    onClick={() => {
                      onSaveDrawing(features)
                      analytics.track('draw_saved_to_graph', { count: shapes.length })
                      setActiveTool(null)
                    }}
                  >
                    <i className="pi pi-plus" /> Add as layer
                  </button>
                  {followUps.map(followUp => (
                    <button
                      key={followUp.id}
                      type="button"
                      className={s.followUp}
                      onClick={() => {
                        onSendDrawing(followUp, features)
                        analytics.track('draw_sent_to_recipe', {
                          recipe: followUp.recipeId,
                          count: shapes.length,
                        })
                        setActiveTool(null)
                      }}
                    >
                      <i className={followUp.icon} /> {followUp.label}
                    </button>
                  ))}
                  <button type="button" className={s.followUp} onClick={copyGeoJson}>
                    <i
                      className={
                        copyState === 'copied'
                          ? 'pi pi-check'
                          : copyState === 'failed'
                            ? 'pi pi-exclamation-triangle'
                            : 'pi pi-copy'
                      }
                    />{' '}
                    {copyState === 'copied'
                      ? 'Copied'
                      : copyState === 'failed'
                        ? 'Copy failed: clipboard blocked'
                        : 'Copy GeoJSON'}
                  </button>
                </div>
              )}
            </>
          )}

          {activeTool === 'measure' && (
            <div className={s.actions}>
              {points.length > 0 && (
                <button type="button" className={s.action} onClick={undoPoint}>
                  <i className="pi pi-undo" /> Undo
                </button>
              )}
              {points.length > 0 && (
                <button type="button" className={s.action} onClick={reset}>
                  <i className="pi pi-trash" /> Clear
                </button>
              )}
              {enoughToMeasure && (
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
            </div>
          )}
        </div>,
        document.body
      )}
    </>
  )
}
