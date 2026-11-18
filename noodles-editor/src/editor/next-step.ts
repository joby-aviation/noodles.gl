// The one next step to suggest, from where the project is (#787): load data, color it by a
// column, animate the camera, export a video. A project past all four gets none. Each step is
// read off the document (and whether this session exported), so the suggestion moves on as
// soon as the user does the thing, by the bar's button or any other way.

import { type EditorDoc, OPERATOR_INDEX } from '@noodles.gl/planner'
import { ensureTimeline, setKey } from './doc-ops'

export type NextStepId = 'load-data' | 'color-by-column' | 'animate-camera' | 'export-video'

export interface NextStep {
  id: NextStepId
  // What the bar says
  text: string
  // Its button
  action: string
}

const STEPS: Record<NextStepId, NextStep> = {
  'load-data': {
    id: 'load-data',
    text: 'Start with your data: a CSV, GeoJSON or Parquet file.',
    action: 'Import a file',
  },
  'color-by-column': {
    id: 'color-by-column',
    text: 'Color your layer by a column of your data.',
    action: 'Choose a color',
  },
  'animate-camera': {
    id: 'animate-camera',
    text: 'Animate the camera so the map moves when it plays.',
    action: 'Add a camera move',
  },
  'export-video': {
    id: 'export-video',
    text: 'Your map is animated. Export it as a video.',
    action: 'Show Export',
  },
}

const opOf = (type: string) => OPERATOR_INDEX.get(type)

/** Whether a node reads or makes rows: a data source or a table operator. */
const isData = (op: string) => {
  const category = opOf(op)?.category
  return category === 'data' || category === 'table'
}

const isLayer = (op: string) => opOf(op)?.category === 'layer'

// A layer colored by its rows: any color channel set (`color`, `sourceColor`, ...)
const colorsByColumn = (node: EditorDoc['nodes'][number]) =>
  (opOf(node.op)?.params ?? []).some(p => {
    if (p.kind !== 'expr' || !/color/i.test(p.name)) return false
    const value = node.params[p.name]
    return typeof value === 'string' ? value.trim() !== '' : value !== undefined
  })

export function nextStep(doc: EditorDoc, { exported = false } = {}): NextStep | undefined {
  if (!doc.nodes.some(n => isData(n.op))) return STEPS['load-data']
  const layers = doc.nodes.filter(n => isLayer(n.op))
  if (layers.length > 0 && !layers.some(colorsByColumn)) return STEPS['color-by-column']
  const animated = (doc.timeline?.tracks ?? []).some(t => t.keyframes.length > 1)
  if (!animated) return STEPS['animate-camera']
  return exported ? undefined : STEPS['export-video']
}

/** The layer to color: the first one, the one most likely to be the user's own. */
export function layerToColor(doc: EditorDoc): string | undefined {
  return doc.nodes.find(n => isLayer(n.op))?.id
}

/**
 * A camera move to start from: the deck's bearing turns a quarter turn over the timeline,
 * keyframed so the user can drag the keys after. False when there is no deck to move.
 */
export function addCameraMove(doc: EditorDoc): boolean {
  const deck = doc.nodes.find(n => n.op === 'deck')
  if (!deck) return false
  const bearing = typeof deck.params.bearing === 'number' ? deck.params.bearing : 0
  const { length } = ensureTimeline(doc)
  setKey(doc, `${deck.id}.bearing`, 0, bearing)
  setKey(doc, `${deck.id}.bearing`, length, bearing + 90)
  return true
}
