// Collapsible wrapper for the TimelinePanel
// Shows a thin tab when collapsed, full panel when expanded
// The top edge is draggable to resize the panel height, persisted to localStorage.

import { useCallback, useEffect } from 'react'
import { useUIStore } from '../../noodles/store'
import s from './CollapsibleTimelinePanel.module.css'
import { TimelinePanel } from './TimelinePanel'

const STORAGE_KEY = 'noodles-timeline-height'
const MIN_HEIGHT = 150
const MAX_HEIGHT = 800

function clampHeight(h: number) {
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, h))
}

export function CollapsibleTimelinePanel() {
  const expanded = useUIStore(state => state.timelineExpanded)
  const setExpanded = useUIStore(state => state.setTimelineExpanded)
  const height = useUIStore(state => state.timelineHeight)
  const setHeight = useUIStore(state => state.setTimelineHeight)

  // Restore persisted height on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored !== null) {
      const parsed = parseInt(stored, 10)
      if (!Number.isNaN(parsed)) setHeight(clampHeight(parsed))
    }
  }, [setHeight])

  const onResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const startY = e.clientY
      const startHeight = height

      function onMouseMove(ev: MouseEvent) {
        const newHeight = clampHeight(startHeight + (startY - ev.clientY))
        setHeight(newHeight)
        localStorage.setItem(STORAGE_KEY, String(newHeight))
      }

      function onMouseUp() {
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [height, setHeight],
  )

  if (!expanded) {
    return (
      <button
        type="button"
        className={s.timelineCollapseTab}
        onClick={() => setExpanded(true)}
        title="Expand Timeline (click to open)"
      >
        <ChevronUpIcon />
        <span>Timeline</span>
      </button>
    )
  }

  return (
    <div className={s.timelineCollapsibleContainer} style={{ height }}>
      <hr
        aria-label="Drag to resize timeline"
        aria-valuenow={height}
        aria-valuemin={MIN_HEIGHT}
        aria-valuemax={MAX_HEIGHT}
        aria-orientation="vertical"
        tabIndex={0}
        className={s.resizeHandle}
        onMouseDown={onResizeMouseDown}
        title="Drag to resize timeline"
      />
      <TimelinePanel height={height - 4} onCollapse={() => setExpanded(false)} />
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
