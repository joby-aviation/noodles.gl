// The timeline panel on the document's keyframes. The panel keeps its own store (selection,
// drag state, the playhead), so its tracks are a view of `doc.timeline`: a document change
// (load, undo, keying a parameter) replaces the panel's tracks, and an edit in the panel (a
// keyframe dragged, a handle bent, the length changed) writes the document, one undo step per
// gesture.
//
// The panel names a track `node / param`; the document's tracks drive `nodeId.param`.

import {
  type EditorDoc,
  type Keyframe,
  nameOf,
  type Timeline,
  type Track,
} from '@noodles.gl/planner'
import { useTimelineStore } from '../timeline/timeline-store'
import type { Keyframe as PanelKeyframe, Track as PanelTrack } from '../timeline/types'
import type { DocStore } from './doc-store'

const splitTarget = (target: string) => {
  const dot = target.lastIndexOf('.')
  return { nodeId: target.slice(0, dot), param: target.slice(dot + 1) }
}

/** A track's name in the panel: the node's name, then the parameter. */
export function trackLabel(doc: EditorDoc, target: string): string {
  const { nodeId, param } = splitTarget(target)
  const node = doc.nodes.find(n => n.id === nodeId)
  return `${node ? nameOf(node) : nodeId} / ${param}`
}

const toPanelKey = (k: Keyframe): PanelKeyframe => ({
  id: k.id,
  position: k.time,
  value: k.value,
  interpolation: k.interpolation,
  ...(k.handles ? { handles: { ...k.handles, type: 'aligned' as const } } : {}),
})

const toDocKey = (k: PanelKeyframe): Keyframe => ({
  id: k.id,
  time: k.position,
  value: typeof k.value === 'number' || typeof k.value === 'string' ? k.value : Number(k.value),
  interpolation: k.interpolation,
  ...(k.handles && k.interpolation === 'bezier'
    ? { handles: { left: k.handles.left, right: k.handles.right } }
    : {}),
})

// Set while the panel is being changed to match the document, so the change is not written
// back as an edit.
let applying = false

/** Reset the panel (stop, rewind, clear) without that being an edit of any document. */
export function resetTimelinePanel(): void {
  applying = true
  try {
    useTimelineStore.getState().reset()
  } finally {
    applying = false
  }
}

/** Keep the timeline panel and the document's timeline in step until the result is called. */
export function bindTimeline(store: DocStore): () => void {
  let shown: Timeline | undefined | null = null
  /** Panel track id -> document track target, for writing panel edits back. */
  const targets = new Map<string, string>()

  const fromDoc = () => {
    const { doc } = store.get()
    if (doc.timeline === shown) return
    shown = doc.timeline
    applying = true
    try {
      targets.clear()
      const tracks = new Map<string, PanelTrack>()
      for (const t of doc.timeline?.tracks ?? []) {
        const id = trackLabel(doc, t.target)
        targets.set(id, t.target)
        tracks.set(id, {
          id,
          fieldPath: id,
          keyframes: t.keyframes.map(toPanelKey),
          defaultValue: t.keyframes[0]?.value ?? 0,
        })
      }
      const state = useTimelineStore.getState()
      useTimelineStore.setState({
        tracks,
        sequence: {
          ...state.sequence,
          length: doc.timeline?.length ?? state.sequence.length,
          fps: doc.timeline?.fps ?? state.sequence.fps,
        },
      })
    } finally {
      applying = false
    }
  }

  const unsubscribeDoc = store.subscribe(fromDoc)
  const unsubscribePanel = useTimelineStore.subscribe(
    s => [s.tracks, s.sequence.length, s.sequence.fps] as const,
    ([tracks, length, fps]) => {
      if (applying) return
      const timeline: Timeline = {
        length,
        fps,
        tracks: [...tracks.values()]
          .filter(t => t.keyframes.length > 0 && targets.has(t.id))
          .map(t => ({
            target: targets.get(t.id) as string,
            keyframes: [...t.keyframes].sort((a, b) => a.position - b.position).map(toDocKey),
          })) satisfies Track[],
      }
      store.edit(d => {
        d.timeline = timeline
      }, 'timeline')
      shown = store.get().doc.timeline
    },
    {
      equalityFn: (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2],
    }
  )
  fromDoc()
  return () => {
    unsubscribeDoc()
    unsubscribePanel()
  }
}
