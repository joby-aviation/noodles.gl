import { getTimelineStore } from '../../timeline/timeline-store'
import { useUIStore } from '../store'

// Open the timeline panel when the loaded project has keyframes, so its animation is
// visible on first open. Never collapses it: a project without keyframes leaves the
// panel as the user left it.
export function expandTimelineIfAnimated(): void {
  const { tracks } = getTimelineStore()
  const animated = [...tracks.values()].some(track => track.keyframes.length > 0)
  if (animated) useUIStore.getState().setTimelineExpanded(true)
}
