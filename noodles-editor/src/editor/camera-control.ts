// Dragging the map edits the camera of the selected node, when that node is the camera the
// map shows: the deck node's own camera, or the View State node wired into its view state.
// A camera parameter an expression, a reference or a wire drives cannot be dragged; a
// keyframed one gets a key at the playhead.

import type { EditorDoc } from '@noodles.gl/planner'
import { setParam } from './doc-ops'

export const CAMERA_PARAMS = ['longitude', 'latitude', 'zoom', 'pitch', 'bearing'] as const

export interface CameraControl {
  /** The selected camera node, when one is selected. */
  nodeId: string | null
  enabled: boolean
  /** Why dragging is off, for a selected camera; null when it is on or nothing is selected. */
  reason: string | null
}

const isCamera = (doc: EditorDoc, id: string) => {
  const op = doc.nodes.find(n => n.id === id)?.op
  return op === 'deck' || op === 'view-state'
}

/** The node whose camera the map shows: a View State wired into the deck, else the deck. */
export function drivingCamera(doc: EditorDoc): string | null {
  const deck =
    doc.nodes.find(n => n.op === 'deck' && !n.parent) ?? doc.nodes.find(n => n.op === 'deck')
  if (!deck) return null
  const wire = doc.edges.find(e => e.target === deck.id && e.targetPort === 'viewState')
  if (!wire) return deck.id
  return doc.nodes.find(n => n.id === wire.source)?.op === 'view-state' ? wire.source : null
}

export function cameraControlOf(
  doc: EditorDoc,
  selected: readonly string[],
  { isRendering, isPlaying }: { isRendering: boolean; isPlaying: boolean }
): CameraControl {
  const cameras = selected.filter(id => isCamera(doc, id))
  if (selected.length !== 1 || cameras.length !== 1) {
    return {
      nodeId: null,
      enabled: false,
      reason: cameras.length ? 'Select one camera node to drag the map.' : null,
    }
  }
  const nodeId = cameras[0]
  const off = (reason: string): CameraControl => ({ nodeId, enabled: false, reason })
  if (isRendering) return off('Camera controls are disabled while exporting.')
  // A write during playback would land on whatever frame is playing
  if (isPlaying) return off('Pause the timeline to drag the camera.')
  if (drivingCamera(doc) !== nodeId) {
    return off('This camera does not drive the visible map, so dragging cannot edit it.')
  }
  const node = doc.nodes.find(n => n.id === nodeId)
  const wired = CAMERA_PARAMS.filter(p =>
    doc.edges.some(e => e.target === nodeId && e.targetPort === `par:${p}`)
  )
  if (wired.length) return off(`Disconnect camera inputs to drag the map: ${wired.join(', ')}.`)
  const driven = CAMERA_PARAMS.filter(p => {
    const v = node?.params[p]
    return v !== null && typeof v === 'object' && !Array.isArray(v)
  })
  if (driven.length) {
    return off(`Clear camera expressions and references to drag the map: ${driven.join(', ')}.`)
  }
  return { nodeId, enabled: true, reason: null }
}

/** The map's view state written to a camera node: a key at `time` where a param is keyframed. */
export function writeCamera(doc: EditorDoc, nodeId: string, viewState: unknown, time: number) {
  if (!viewState || typeof viewState !== 'object') return
  const v = viewState as Record<string, unknown>
  for (const p of CAMERA_PARAMS) {
    if (typeof v[p] === 'number' && Number.isFinite(v[p])) setParam(doc, nodeId, p, v[p], time)
  }
}

/**
 * One drag, one undo step: every write of a gesture carries the same edit tag. deck.gl reports
 * gestures as interaction state rather than start and end events, hence `setInteracting`.
 */
export function cameraGesture() {
  let tag: string | null = null
  let count = 0
  let interacting = false
  return {
    begin() {
      tag ??= `camera:${++count}`
    },
    finish() {
      interacting = false
      tag = null
    },
    setInteracting(active: boolean) {
      if (active && !interacting) tag ??= `camera:${++count}`
      if (!active && interacting) tag = null
      interacting = active
    },
    tag(): string {
      tag ??= `camera:${++count}`
      return tag
    },
  }
}
