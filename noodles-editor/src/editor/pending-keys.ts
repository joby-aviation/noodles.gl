// Changes to keyframed parameters that are not keyed yet, as Blender marks an animated property
// you changed without inserting a keyframe. Moving a locked camera writes its static parameters
// to the document, but a keyframed one only here: the map shows the new value and its row marks
// it changed, until its keyframe button keys it at the playhead. Moving the playhead, opening
// another project, starting an export or taking a screenshot drops them, as Blender reverts on
// a frame change. So does any other edit to the parameter's keyframes, which a change made
// before it must not undo.

import type { EditorDoc } from '@noodles.gl/planner'
import { create } from 'zustand'

interface PendingKeys {
  // By parameter key, `deck.zoom`
  values: Readonly<Record<string, number>>
  // Each change's track as it was when the change was made
  basis: Readonly<Record<string, string>>
  set: (doc: EditorDoc, values: Record<string, number>) => void
  clear: (keys?: readonly string[]) => void
  /** Drop changes whose keyframes were edited, or removed, since. */
  reconcile: (doc: EditorDoc) => void
}

const trackOf = (doc: EditorDoc, key: string) => {
  const track = doc.timeline?.tracks.find(t => t.target === key)
  return track ? JSON.stringify(track.keyframes) : ''
}

export const usePendingKeys = create<PendingKeys>((set, get) => ({
  values: {},
  basis: {},
  set: (doc, values) =>
    set(s => ({
      values: { ...s.values, ...values },
      basis: {
        ...s.basis,
        ...Object.fromEntries(Object.keys(values).map(k => [k, trackOf(doc, k)])),
      },
    })),
  clear: keys =>
    set(s => {
      if (!keys) return Object.keys(s.values).length ? { values: {}, basis: {} } : s
      const values = { ...s.values }
      const basis = { ...s.basis }
      for (const k of keys) {
        delete values[k]
        delete basis[k]
      }
      return { values, basis }
    }),
  reconcile: doc => {
    const { values, basis, clear } = get()
    const stale = Object.keys(values).filter(k => !trackOf(doc, k) || trackOf(doc, k) !== basis[k])
    if (stale.length) clear(stale)
  },
}))

export const pendingKeys = () => usePendingKeys.getState()
