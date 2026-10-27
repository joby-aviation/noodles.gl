// Moving the map with Lock to view on (viewport-camera.ts) edits the active camera: the deck
// node's own camera, or the View State node wired into its view state. A camera that another
// node, an expression, a reference or a wire drives cannot be moved from the map, nor can any
// camera while the timeline plays or an export runs; the map moves the viewport instead. A
// keyframed camera parameter gets a key at the playhead.

import { type EditorDoc, nameOf } from '@noodles.gl/planner'
import { setParam } from './doc-ops'

export const CAMERA_PARAMS = ['longitude', 'latitude', 'zoom', 'pitch', 'bearing'] as const

export interface CameraControl {
  /** The active camera's node, when the map shows a node's camera. */
  nodeId: string | null
  enabled: boolean
  /** Why the map can't move the active camera; null when it can. */
  reason: string | null
}

/** The node whose camera the map shows: a View State wired into the deck, else the deck. */
export function drivingCamera(doc: EditorDoc): string | null {
  const deck = deckOf(doc)
  if (!deck) return null
  const wire = doc.edges.find(e => e.target === deck.id && e.targetPort === 'viewState')
  if (!wire) return deck.id
  return doc.nodes.find(n => n.id === wire.source)?.op === 'view-state' ? wire.source : null
}

const deckOf = (doc: EditorDoc) =>
  doc.nodes.find(n => n.op === 'deck' && !n.parent) ?? doc.nodes.find(n => n.op === 'deck')

export function cameraControlOf(
  doc: EditorDoc,
  { isRendering, isPlaying }: { isRendering: boolean; isPlaying: boolean }
): CameraControl {
  const nodeId = drivingCamera(doc)
  const off = (reason: string): CameraControl => ({ nodeId, enabled: false, reason })
  if (!nodeId) {
    const deck = deckOf(doc)
    const wire = deck && doc.edges.find(e => e.target === deck.id && e.targetPort === 'viewState')
    const from = wire && doc.nodes.find(n => n.id === wire.source)
    return off(
      from ? `${nameOf(from)} drives the camera, so the map can't move it.` : 'No camera to move.'
    )
  }
  if (isRendering) return off('The camera stays still while exporting.')
  // A write during playback would land on whatever frame is playing
  if (isPlaying) return off('Pause the timeline to move the camera.')
  const node = doc.nodes.find(n => n.id === nodeId)
  const name = node ? nameOf(node) : nodeId
  const wired = CAMERA_PARAMS.filter(p =>
    doc.edges.some(e => e.target === nodeId && e.targetPort === `par:${p}`)
  )
  if (wired.length) return off(`Wires drive ${name}'s ${wired.join(', ')}.`)
  const driven = CAMERA_PARAMS.filter(p => {
    const v = node?.params[p]
    return v !== null && typeof v === 'object' && !Array.isArray(v)
  })
  if (driven.length) return off(`Expressions or references drive ${name}'s ${driven.join(', ')}.`)
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
