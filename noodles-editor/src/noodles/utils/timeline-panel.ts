import type { EditorDoc } from '@noodles.gl/planner'
import { useUIStore } from '../../editor/ui-store'

// Open the timeline panel when the opened document has keyframes, so its animation is
// visible on first open. Never collapses it: a project without keyframes leaves the
// panel as the user left it.
export function expandTimelineIfAnimated(doc: EditorDoc): void {
  const animated = (doc.timeline?.tracks ?? []).some(track => track.keyframes.length > 0)
  if (animated) useUIStore.getState().setTimelineExpanded(true)
}
