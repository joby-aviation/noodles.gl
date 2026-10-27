// Moving the map with Lock to view on (viewport-camera.ts) edits the active camera: the deck
// node's own camera, or the View State node wired into its view state, directly or through the
// Switch Values that pick it at the playhead. A camera that another
// node, an expression, a reference or a wire drives cannot be moved from the map, nor can any
// camera while the timeline plays or an export runs. A keyframed camera parameter isn't keyed
// by moving the map: its new value waits as an unkeyed change (pending-keys.ts).

import { type DocNode, type EditorDoc, evaluateTrack, nameOf } from '@noodles.gl/planner'
import { setParam } from './doc-ops'

export const CAMERA_PARAMS = ['longitude', 'latitude', 'zoom', 'pitch', 'bearing'] as const

export interface CameraControl {
  /** The active camera's node, when the map shows a node's camera. */
  nodeId: string | null
  enabled: boolean
  /** Why the map can't move the active camera; null when it can. */
  reason: string | null
}

/**
 * The node whose camera the map shows at `time`: a View State wired into the deck, or the one a
 * Switch Value wired into it picks there, else the deck itself.
 */
export function drivingCamera(doc: EditorDoc, time = 0): string | null {
  const deck = deckOf(doc)
  if (!deck) return null
  const wire = doc.edges.find(e => e.target === deck.id && e.targetPort === 'viewState')
  if (!wire) return deck.id
  let source = doc.nodes.find(n => n.id === wire.source)
  // Switches can feed switches; a loop of them picks nothing
  for (let hops = 0; source?.op === 'switch-value' && hops < 16; hops++) {
    const picked = switchedInput(doc, source, time)
    source = picked ? doc.nodes.find(n => n.id === picked) : undefined
  }
  return source?.op === 'view-state' ? source.id : null
}

/**
 * The input a Switch Value picks at `time`, as its build does: undefined while its Index is an
 * expression, a reference or a wire, or blends two inputs.
 */
export function switchedInput(doc: EditorDoc, node: DocNode, time: number): string | undefined {
  if (doc.edges.some(e => e.target === node.id && e.targetPort === 'par:index')) return undefined
  const track = doc.timeline?.tracks.find(t => t.target === `${node.id}.index`)
  const raw = track ? evaluateTrack(track, time) : (node.params.index ?? 0)
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined
  const inputs = doc.edges
    .filter(e => e.target === node.id && e.targetPort === 'par:values')
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
  if (inputs.length === 0) return undefined
  const i = Math.max(0, Math.min(raw, inputs.length - 1))
  if (node.params.blend === true && Math.floor(i) !== i) return undefined
  return inputs[Math.floor(i)].source
}

const deckOf = (doc: EditorDoc) =>
  doc.nodes.find(n => n.op === 'deck' && !n.parent) ?? doc.nodes.find(n => n.op === 'deck')

export function cameraControlOf(
  doc: EditorDoc,
  { isRendering, isPlaying, time = 0 }: { isRendering: boolean; isPlaying: boolean; time?: number }
): CameraControl {
  const nodeId = drivingCamera(doc, time)
  const off = (reason: string): CameraControl => ({ nodeId, enabled: false, reason })
  if (!nodeId) {
    const deck = deckOf(doc)
    const wire = deck && doc.edges.find(e => e.target === deck.id && e.targetPort === 'viewState')
    const from = wire && doc.nodes.find(n => n.id === wire.source)
    if (from?.op === 'switch-value')
      return off(`${nameOf(from)} isn't on one View State here, so the map can't move a camera.`)
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

/**
 * The map's view state written to a camera node: its static parameters change, and its
 * keyframed ones are sorted by whether they moved from `current`, the camera as keyed at the
 * playhead. The ones that moved are held as unkeyed changes (pending-keys.ts); the ones that
 * didn't, or came back, have no change to hold.
 */
export function writeCamera(
  doc: EditorDoc,
  nodeId: string,
  viewState: unknown,
  current?: Partial<Record<(typeof CAMERA_PARAMS)[number], number>>
): { changed: Record<string, number>; same: string[] } {
  const changed: Record<string, number> = {}
  const same: string[] = []
  if (!viewState || typeof viewState !== 'object') return { changed, same }
  const v = viewState as Record<string, unknown>
  for (const p of CAMERA_PARAMS) {
    const value = v[p]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    const key = `${nodeId}.${p}`
    if (!doc.timeline?.tracks.some(t => t.target === key)) setParam(doc, nodeId, p, value)
    else if (current?.[p] !== undefined && sameValue(value, current[p])) same.push(key)
    else changed[key] = value
  }
  return { changed, same }
}

// A map reports a pan's zoom back with float noise
const sameValue = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b))

/** Whether a camera write would change any static parameter, so it needs an undo step. */
export const writesStatic = (doc: EditorDoc, nodeId: string) =>
  CAMERA_PARAMS.some(p => !doc.timeline?.tracks.some(t => t.target === `${nodeId}.${p}`))

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
