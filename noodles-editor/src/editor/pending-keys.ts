// Changes to keyframed parameters that are not keyed yet, as Blender marks an animated property
// you changed without inserting a keyframe. Moving a locked camera writes its static parameters
// to the document, but a keyframed one only here: the map shows the new value and its row marks
// it changed, until its keyframe button keys it at the playhead. Moving the playhead, opening
// another project or starting an export drops them, as Blender reverts on a frame change.

import { create } from 'zustand'

interface PendingKeys {
  // By parameter key, `deck.zoom`
  values: Readonly<Record<string, number>>
  set: (values: Record<string, number>) => void
  clear: (keys?: readonly string[]) => void
}

export const usePendingKeys = create<PendingKeys>(set => ({
  values: {},
  set: values => set(s => ({ values: { ...s.values, ...values } })),
  clear: keys =>
    set(s => {
      if (!keys) return Object.keys(s.values).length ? { values: {} } : s
      const values = { ...s.values }
      for (const k of keys) delete values[k]
      return { values }
    }),
}))

export const pendingKeys = () => usePendingKeys.getState()
