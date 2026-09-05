import { type Field, hasChannelFields } from '../fields'
import { MapViewStateOp } from '../operators'
import { getOp } from '../store'

export const CAMERA_INPUT_NAMES = ['center', 'zoom', 'pitch', 'bearing'] as const

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

function hasExternalConnection(field: Field): boolean {
  return Array.from(field.subscriptions.keys()).some(id => !id.startsWith('__'))
}

function getConnectedCameraInputs(op: MapViewStateOp): string[] {
  const connectedInputs: string[] = []
  const center = op.inputs.center

  if (hasExternalConnection(center)) connectedInputs.push('center')
  if (hasChannelFields(center)) {
    for (const channelName of ['lng', 'lat']) {
      const channel = center.channelFields[channelName]
      if (channel && hasExternalConnection(channel)) {
        connectedInputs.push(`center.${channelName}`)
      }
    }
  }

  for (const name of ['zoom', 'pitch', 'bearing'] as const) {
    if (hasExternalConnection(op.inputs[name])) connectedInputs.push(name)
  }
  return connectedInputs
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

  const connectedFields = getConnectedCameraInputs(selectedOp)
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

export function updateCameraInputs(op: MapViewStateOp, value: unknown): boolean {
  const viewState = extractCameraViewState(value)
  if (!viewState || op.locked.value) return false
  if (getConnectedCameraInputs(op).length > 0) return false

  op.inputs.center.setValue({ lng: viewState.longitude, lat: viewState.latitude })
  op.inputs.zoom.setValue(viewState.zoom)
  op.inputs.pitch.setValue(viewState.pitch ?? op.inputs.pitch.value)
  op.inputs.bearing.setValue(viewState.bearing ?? op.inputs.bearing.value)
  return true
}
