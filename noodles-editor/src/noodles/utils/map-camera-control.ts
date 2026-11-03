import { useEffect, useState } from 'react'
import { type Observable, skip } from 'rxjs'
import {
  ContainerOp,
  DeckRendererOp,
  GraphInputOp,
  GraphOutputOp,
  MaplibreBasemapOp,
  MapViewStateOp,
  RerouteOp,
} from '../operators'
import { getOp } from '../store'
import { getParentPath } from './path-utils'

export const CAMERA_INPUT_NAMES = ['longitude', 'latitude', 'zoom', 'pitch', 'bearing'] as const
type CameraInputName = (typeof CAMERA_INPUT_NAMES)[number]

export interface CameraViewState {
  longitude: number
  latitude: number
  zoom: number
  pitch?: number
  bearing?: number
}

// The parts of a graph edge needed to trace connections (React Flow edges satisfy this)
export interface GraphEdge {
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

export interface CameraControlContext {
  // Every value edge in the project, not just the ones in the displayed container
  edges: readonly GraphEdge[]
  isRendering: boolean
  // Writes during playback would land on whatever frame is playing, keyframing along the way
  isPlaying: boolean
}

export interface CameraControlState {
  op: MapViewStateOp | null
  enabled: boolean
  reason: string | null
}

export function createCameraGestureHistory(
  capture: () => string | null,
  commit: (before: string) => void
) {
  let before: string | null = null
  let interacting = false
  const begin = () => {
    if (before === null) before = capture()
  }
  // Also call this when camera control turns off mid-gesture (playback, export, a selection
  // change): neither the map nor deck reports the end of a gesture it stopped handling, and
  // a pending snapshot would otherwise become the "before" of the next drag
  const finish = () => {
    interacting = false
    if (before === null) return
    commit(before)
    before = null
  }
  return {
    begin,
    finish,
    // deck.gl reports gestures as interaction state rather than start and end events
    setInteracting(active: boolean) {
      if (active && !interacting) begin()
      if (!active && interacting) finish()
      interacting = active
    },
  }
}

const OUT_OP_ID = '/out'

function findIncomingEdge(edges: readonly GraphEdge[], target: string, targetHandle: string) {
  return edges.find(edge => edge.target === target && edge.targetHandle === targetHandle)
}

// The input an operator copies unchanged to the output this edge leaves from, or null when
// the operator computes its output. Containers pass values across their boundary: out.out
// is the value of the GraphOutputOp the container selected (ContainerOp.outputOp), and a
// GraphInputOp's out.value is the container's par.in. Custom container inputs are typed
// fields that can coerce a value, so they don't count as pass-throughs.
function passThroughInput(edge: GraphEdge): { target: string; targetHandle: string } | null {
  const op = getOp(edge.source)
  const handle = edge.sourceHandle
  if (op instanceof RerouteOp && handle === 'out.value') {
    return { target: op.id, targetHandle: 'par.value' }
  }
  if (op instanceof GraphOutputOp && handle === 'out.propagatedValue') {
    return { target: op.id, targetHandle: 'par.value' }
  }
  if (op instanceof ContainerOp && handle === 'par.in') {
    return { target: op.id, targetHandle: 'par.in' }
  }
  if (op instanceof ContainerOp && handle === 'out.out') {
    const output = op.outputOp
    return output ? { target: output.id, targetHandle: 'par.value' } : null
  }
  if (op instanceof GraphInputOp && handle === 'out.value') {
    const containerId = getParentPath(op.id)
    if (!containerId || !(getOp(containerId) instanceof ContainerOp)) return null
    return { target: containerId, targetHandle: 'par.in' }
  }
  return null
}

// Follow pass-throughs (Reroutes and container boundaries) back to the edge leaving the
// operator that produced the value
function resolveSourceEdge(
  edges: readonly GraphEdge[],
  edge: GraphEdge | undefined
): GraphEdge | undefined {
  // Keyed by input rather than operator: a value can leave a container through out.out
  // and enter it again through par.in
  const visited = new Set<string>()
  let current = edge
  while (current) {
    const input = passThroughInput(current)
    if (!input) return current
    const key = `${input.target}.${input.targetHandle}`
    if (visited.has(key)) return undefined
    visited.add(key)
    current = findIncomingEdge(edges, input.target, input.targetHandle)
  }
  return current
}

function cameraOpIdFromEdge(edge: GraphEdge | undefined): string | null {
  if (edge?.sourceHandle !== 'out.viewState') return null
  return getOp(edge.source) instanceof MapViewStateOp ? edge.source : null
}

function hasCameraValues(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  return CAMERA_INPUT_NAMES.some(name => name in value) || extractCameraViewState(value) !== null
}

// Returns the id of the MapViewStateOp whose output reaches the rendered view unchanged, or
// null when the view's camera comes from anything else (another operator, an expression,
// literal values on the renderer, or a transform between the camera and the renderer).
// Mirrors DeckRendererOp.execute: its viewState input overrides the basemap's camera.
export function findViewCameraOpId(edges: readonly GraphEdge[]): string | null {
  const visEdge = resolveSourceEdge(edges, findIncomingEdge(edges, OUT_OP_ID, 'par.vis'))
  if (visEdge?.sourceHandle !== 'out.vis') return null
  const renderer = getOp(visEdge.source)
  if (!(renderer instanceof DeckRendererOp)) return null

  const viewStateEdge = findIncomingEdge(edges, renderer.id, 'par.viewState')
  if (viewStateEdge) return cameraOpIdFromEdge(resolveSourceEdge(edges, viewStateEdge))
  const rendererViewState = renderer.inputs.viewState
  if (rendererViewState.expression !== null || hasCameraValues(rendererViewState.value)) return null

  const basemapEdge = resolveSourceEdge(edges, findIncomingEdge(edges, renderer.id, 'par.basemap'))
  if (!basemapEdge) return null
  const directCamera = cameraOpIdFromEdge(basemapEdge)
  if (directCamera) return directCamera

  const basemap = getOp(basemapEdge.source)
  if (!(basemap instanceof MaplibreBasemapOp) || basemapEdge.sourceHandle !== 'out.maplibre') {
    return null
  }
  const basemapViewState = basemap.inputs.viewState
  const overridden =
    basemapViewState.expression !== null ||
    Object.values(basemapViewState.fields).some(field => field.expression !== null) ||
    edges.some(
      edge => edge.target === basemap.id && edge.targetHandle?.startsWith('par.viewState.')
    )
  if (overridden) return null
  return cameraOpIdFromEdge(
    resolveSourceEdge(edges, findIncomingEdge(edges, basemap.id, 'par.viewState'))
  )
}

export function getCameraControlState(
  selectedNodeIds: string[],
  { edges, isRendering, isPlaying }: CameraControlContext
): CameraControlState {
  if (selectedNodeIds.length !== 1) {
    const includesCamera = selectedNodeIds.some(id => getOp(id) instanceof MapViewStateOp)
    return {
      op: null,
      enabled: false,
      reason: includesCamera ? 'Select exactly one MapViewState node to edit the camera.' : null,
    }
  }

  const selectedOp = getOp(selectedNodeIds[0])
  if (!(selectedOp instanceof MapViewStateOp)) return { op: null, enabled: false, reason: null }
  if (isRendering) {
    return {
      op: selectedOp,
      enabled: false,
      reason: 'Camera controls are disabled while exporting.',
    }
  }
  if (isPlaying) {
    return { op: selectedOp, enabled: false, reason: 'Pause the timeline to drag the camera.' }
  }
  if (findViewCameraOpId(edges) !== selectedOp.id) {
    return {
      op: selectedOp,
      enabled: false,
      reason: 'This MapViewState does not drive the visible map, so dragging cannot edit it.',
    }
  }
  if (selectedOp.locked.value) {
    return { op: selectedOp, enabled: false, reason: 'Unlock the MapViewState node to edit it.' }
  }

  // Read connections from the edge list rather than field subscriptions: the edges are
  // React state, so connecting or disconnecting re-renders with the new answer
  const connectedFields = CAMERA_INPUT_NAMES.filter(name =>
    edges.some(edge => edge.target === selectedOp.id && edge.targetHandle === `par.${name}`)
  )
  if (connectedFields.length > 0) {
    return {
      op: selectedOp,
      enabled: false,
      reason: `Disconnect camera inputs to drag the map: ${connectedFields.join(', ')}.`,
    }
  }
  const expressionFields = CAMERA_INPUT_NAMES.filter(
    name => selectedOp.inputs[name].expression !== null
  )
  if (expressionFields.length > 0) {
    return {
      op: selectedOp,
      enabled: false,
      reason: `Clear camera input expressions to drag the map: ${expressionFields.join(', ')}.`,
    }
  }

  return { op: selectedOp, enabled: true, reason: null }
}

// getCameraControlState as a hook that re-renders when the selected camera is locked or
// unlocked, or an input enters or leaves expression mode. Those live on RxJS subjects,
// not React state, so without this the control only updated on an unrelated re-render.
// Edges, playback and export state are React state and already re-render the caller.
export function useCameraControlState(
  selectedNodeIds: string[],
  context: CameraControlContext
): CameraControlState {
  const selectedOp = selectedNodeIds.length === 1 ? getOp(selectedNodeIds[0]) : undefined
  const camera = selectedOp instanceof MapViewStateOp ? selectedOp : null
  const [, setVersion] = useState(0)

  useEffect(() => {
    if (!camera) return
    const sources: Observable<unknown>[] = [
      camera.locked,
      ...CAMERA_INPUT_NAMES.map(name => camera.inputs[name].expression$),
    ]
    const bump = () => setVersion(version => version + 1)
    // BehaviorSubjects replay their current value on subscribe; react to later changes only
    const subscriptions = sources.map(source => source.pipe(skip(1)).subscribe(bump))
    return () => {
      for (const subscription of subscriptions) subscription.unsubscribe()
    }
  }, [camera])

  return getCameraControlState(selectedNodeIds, context)
}

export function extractCameraViewState(value: unknown): CameraViewState | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (
    typeof record.longitude === 'number' &&
    typeof record.latitude === 'number' &&
    typeof record.zoom === 'number'
  ) {
    return record as unknown as CameraViewState
  }

  for (const nested of Object.values(record)) {
    const camera = extractCameraViewState(nested)
    if (camera) return camera
  }
  return null
}

// MapLibre reports longitudes outside [-180, 180] after panning across the antimeridian
// (renderWorldCopies). The longitude NumberField rejects those, so wrap before writing.
export function wrapLongitude(longitude: number): number {
  if (longitude >= -180 && longitude <= 180) return longitude
  return ((((longitude + 180) % 360) + 360) % 360) - 180
}

// A connected or expression-driven input gets its value from elsewhere: a write would be
// overwritten by the connection, or would replace the user's expression with a literal
function isCameraInputDriven(op: MapViewStateOp, name: CameraInputName): boolean {
  const field = op.inputs[name]
  return field.subscriptions.size > 0 || field.expression !== null
}

export function updateCameraInputs(op: MapViewStateOp, value: unknown): boolean {
  const viewState = extractCameraViewState(value)
  if (!viewState || op.locked.value) return false
  if (CAMERA_INPUT_NAMES.some(name => isCameraInputDriven(op, name))) return false

  const next: Record<CameraInputName, number | undefined> = {
    longitude: wrapLongitude(viewState.longitude),
    latitude: viewState.latitude,
    zoom: viewState.zoom,
    pitch: viewState.pitch,
    bearing: viewState.bearing,
  }
  for (const name of CAMERA_INPUT_NAMES) {
    const field = op.inputs[name]
    const nextValue = next[name]
    // Move events repeat values (a pan leaves zoom, pitch and bearing alone); skip those
    if (nextValue === undefined || field.value === nextValue) continue
    field.setValue(nextValue)
  }
  return true
}
