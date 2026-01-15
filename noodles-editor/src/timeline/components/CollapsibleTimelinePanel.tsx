// Collapsible wrapper for the TimelinePanel
// Shows a thin tab when collapsed, full panel when expanded

import { useUIStore } from '../../noodles/store'
import { TimelinePanel } from './TimelinePanel'
import './CollapsibleTimelinePanel.css'

export interface CollapsibleTimelinePanelProps {
  height?: number
}

export function CollapsibleTimelinePanel({ height = 250 }: CollapsibleTimelinePanelProps) {
  const expanded = useUIStore(state => state.timelineExpanded)
  const setExpanded = useUIStore(state => state.setTimelineExpanded)

  if (!expanded) {
    return (
      <button
        type="button"
        className="timeline-collapse-tab"
        onClick={() => setExpanded(true)}
        title="Expand Timeline (click to open)"
      >
        <ChevronUpIcon />
        <span>Timeline</span>
      </button>
    )
  }

  return (
    <div className="timeline-collapsible-container" style={{ height }}>
      <TimelinePanel height={height} onCollapse={() => setExpanded(false)} />
    </div>
  )
}

// Simple chevron icon for collapsed state
function ChevronUpIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M3 8L6 5L9 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
