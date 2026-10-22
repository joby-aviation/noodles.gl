import { MapViewStateOp } from '../operators'
import { getOp } from '../store'

export const CAMERA_INPUT_NAMES = ['longitude', 'latitude', 'zoom', 'pitch', 'bearing'] as const
type CameraInputName = (typeof CAMERA_INPUT_NAMES)[number]

export interface CameraViewState {
  longitude: number
  latitude: number
  zoom: number
  pitch?: number
  bearing?: number
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
  return {
    begin() {
      if (before === null) before = capture()
    },
    finish() {
      if (before === null) return
      commit(before)
      before = null
    },
  }
}

export function getCameraControlState(
  selectedNodeIds: string[],
  isRendering: boolean
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
  if (selectedOp.locked.value) {
    return { op: selectedOp, enabled: false, reason: 'Unlock the MapViewState node to edit it.' }
  }

  const connectedFields = CAMERA_INPUT_NAMES.filter(
    name => selectedOp.inputs[name].subscriptions.size > 0
  )
  if (connectedFields.length > 0) {
    return {
      op: selectedOp,
      enabled: false,
      reason: `Disconnect camera inputs to drag the map: ${connectedFields.join(', ')}.`,
    }
  }

  return { op: selectedOp, enabled: true, reason: null }
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

export function updateCameraInputs(op: MapViewStateOp, value: unknown): boolean {
  const viewState = extractCameraViewState(value)
  if (!viewState || op.locked.value) return false
  if (CAMERA_INPUT_NAMES.some(name => op.inputs[name].subscriptions.size > 0)) return false

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
