// Keyframe track component - renders a single track with its keyframes

import { useReactFlow } from '@xyflow/react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  captureTimelineState,
  fireTimelineMutation,
  getTimelineStore,
  useTimelineStore,
} from '../timeline-store'
import type { Keyframe, Track } from '../types'
import { CurvePopup } from './CurvePopup'
import { KeyframeValuePopup } from './KeyframeValuePopup'
import s from './TimelinePanel.module.css'

export interface KeyframeTrackProps {
  track: Track
  showLabelOnly?: boolean
  pixelsPerSecond?: number
  timelineWidth?: number
  sequenceLength?: number
  fps?: number
  opId?: string
  isFirstInGroup?: boolean
  onOpenCurveEditor?: (trackId: string) => void
  connectingFromMarkerId?: string | null
  onKeyframeConnectionDrop?: (trackId: string, keyframeId: string) => void
}

function snapToFrame(time: number, fps: number): number {
  return Math.round(time * fps) / fps
}

// Extract display name from field path
// "maplibre-basemap / viewState / zoom" -> "zoom"
function getDisplayName(fieldPath: string): string {
  const parts = fieldPath.split(' / ')
  return parts[parts.length - 1]
}

interface KeyframeTrackLabelProps {
  track: Track
  opId?: string
  isFirstInGroup?: boolean
  displayName: string
  onOpenCurveEditor?: (trackId: string) => void
}

// Label column for a track — owns context menu state so hooks don't run in keyframe-row mode
function KeyframeTrackLabel({
  track,
  opId,
  isFirstInGroup,
  displayName,
  onOpenCurveEditor,
}: KeyframeTrackLabelProps) {
  const selectedTrackIds = useTimelineStore(state => state.selectedTrackIds)
  const selectTrack = useTimelineStore(state => state.selectTrack)
  const toggleTrackKeyframes = useTimelineStore(state => state.toggleTrackKeyframes)
  const addKeyframe = useTimelineStore(state => state.addKeyframe)
  const deleteKeyframe = useTimelineStore(state => state.deleteKeyframe)
  const position = useTimelineStore(state => state.position)
  const setPosition = useTimelineStore(state => state.setPosition)
  const reactFlow = useReactFlow()

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

  // Close context menu on outside click or Escape
  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', handleKey)
    }
  }, [contextMenu])

  const handleMakeStatic = useCallback(() => {
    const before = captureTimelineState()
    const store = getTimelineStore()
    store.deleteTrack(track.id)
    fireTimelineMutation('Make static', before)
    setContextMenu(null)
  }, [track.id])

  const isTrackSelected = selectedTrackIds.has(track.id)
  const eps = 0.001
  const prevKf = [...track.keyframes].filter(kf => kf.position < position - eps).at(-1)
  const nextKf = track.keyframes.find(kf => kf.position > position + eps)
  const atKf = track.keyframes.find(kf => Math.abs(kf.position - position) < eps)
  const hasKfs = track.keyframes.length > 0

  // The React Flow node ID for this track's operator (fieldPath opId has no leading slash)
  const rfNodeId = `/${track.fieldPath.split(' / ')[0]}`

  const handleLabelClick = (e: React.MouseEvent) => {
    if (e.shiftKey) {
      toggleTrackKeyframes(track.id)
    } else {
      selectTrack(track.id)
      // Also select operator so properties panel shows it
      reactFlow.setNodes(nodes => nodes.map(n => ({ ...n, selected: n.id === rfNodeId })))
    }
  }

  const handlePrevKf = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (prevKf) setPosition(prevKf.position)
  }

  const handleNextKf = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (nextKf) setPosition(nextKf.position)
  }

  const handleToggleKeyframe = (e: React.MouseEvent) => {
    e.stopPropagation()
    const before = captureTimelineState()
    if (atKf) {
      deleteKeyframe(track.id, atKf.id)
      fireTimelineMutation('Delete keyframe', before)
    } else {
      const store = getTimelineStore()
      const value = store.evaluateTrack(track.id, position) ?? track.defaultValue
      addKeyframe(track.id, { position, value, interpolation: 'bezier' })
      fireTimelineMutation('Add keyframe', before)
    }
  }

  const handleOpenCurveEditor = (e: React.MouseEvent) => {
    e.stopPropagation()
    reactFlow.setNodes(nodes => nodes.map(n => ({ ...n, selected: n.id === rfNodeId })))
    onOpenCurveEditor?.(track.id)
  }

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Track label selects track for curve editor; shift-click toggles keyframe selection */}
      <div
        className={`${s.timelineTrackLabel} ${isTrackSelected ? s.selected : ''}`}
        title={track.fieldPath}
        onClick={handleLabelClick}
        onContextMenu={e => {
          e.preventDefault()
          setContextMenu({ x: e.clientX, y: e.clientY })
        }}
      >
        {isFirstInGroup ? (
          <>
            <span className={s.timelineTrackOpId}>{opId}</span>
            <span className={s.timelineTrackSep}> - </span>
            <span className={s.timelineTrackName}>{displayName}</span>
          </>
        ) : (
          <>
            <span className={`${s.timelineTrackBranch} ${s.visible}`}>└</span>
            <span className={s.timelineTrackName}>{displayName}</span>
          </>
        )}
        <div className={s.timelineTrackLabelActions}>
          <button
            type="button"
            className={s.timelineTrackLabelBtn}
            onClick={handlePrevKf}
            disabled={!prevKf}
            title="Previous keyframe"
          >
            <PrevKfChevron />
          </button>
          <button
            type="button"
            className={`${s.timelineTrackLabelBtn} ${atKf ? s.atKeyframe : hasKfs ? s.hasKeyframes : ''}`}
            onClick={handleToggleKeyframe}
            title={atKf ? 'Remove keyframe' : 'Add keyframe'}
          >
            <TrackDiamondIcon filled={!!atKf} />
          </button>
          <button
            type="button"
            className={s.timelineTrackLabelBtn}
            onClick={handleNextKf}
            disabled={!nextKf}
            title="Next keyframe"
          >
            <NextKfChevron />
          </button>
          <button
            type="button"
            className={s.timelineTrackLabelBtn}
            onClick={handleOpenCurveEditor}
            title="Open curve editor"
          >
            <OpenCurveEditorIcon />
          </button>
        </div>
      </div>
      {contextMenu &&
        createPortal(
          <div
            className={s.handleTypeMenu}
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onPointerDown={e => e.stopPropagation()}
          >
            <button type="button" onClick={handleMakeStatic}>
              Make static
            </button>
          </div>,
          document.body
        )}
    </>
  )
}

export function KeyframeTrack({
  track,
  showLabelOnly = false,
  pixelsPerSecond = 100,
  timelineWidth = 1000,
  sequenceLength = 10,
  fps = 30,
  opId,
  isFirstInGroup,
  onOpenCurveEditor,
  connectingFromMarkerId,
  onKeyframeConnectionDrop,
}: KeyframeTrackProps) {
  const selectedKeyframeIds = useTimelineStore(state => state.selectedKeyframeIds)
  const selectKeyframe = useTimelineStore(state => state.selectKeyframe)
  const addKeyframe = useTimelineStore(state => state.addKeyframe)

  const [openPopup, setOpenPopup] = useState<{
    k1: Keyframe
    k2: Keyframe
    x: number
    y: number
    applyToSelected: boolean
  } | null>(null)

  const [openValuePopup, setOpenValuePopup] = useState<{
    keyframe: Keyframe
    x: number
    y: number
  } | null>(null)

  const displayName = getDisplayName(track.fieldPath)

  // Handle double-click to add keyframe
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const rect = e.currentTarget.getBoundingClientRect()
      const x = e.clientX - rect.left
      const time = snapToFrame(x / pixelsPerSecond, fps)

      addKeyframe(track.id, {
        position: time,
        value: track.defaultValue,
        interpolation: 'bezier',
      })
    },
    [track.id, track.defaultValue, pixelsPerSecond, fps, addKeyframe]
  )

  // Handle bar segment popup open (called by KeyframeBar after confirming no drag)
  const handleBarClick = useCallback(
    (k1: Keyframe, k2: Keyframe, x: number, y: number) => {
      setOpenValuePopup(null)
      // Apply to all selected keyframes when k1 is part of a multi-selection
      const applyToSelected = selectedKeyframeIds.size > 1 && selectedKeyframeIds.has(k1.id)
      setOpenPopup({ k1, k2, x, y, applyToSelected })
    },
    [selectedKeyframeIds]
  )

  const handleOpenValuePopup = useCallback((kf: Keyframe, x: number, y: number) => {
    setOpenPopup(null)
    setOpenValuePopup({ keyframe: kf, x, y })
  }, [])

  // Render label only — delegate to sub-component so context menu hooks are scoped there
  if (showLabelOnly) {
    return (
      <KeyframeTrackLabel
        track={track}
        opId={opId}
        isFirstInGroup={isFirstInGroup}
        displayName={displayName}
        onOpenCurveEditor={onOpenCurveEditor}
      />
    )
  }

  // Generate bar segments between consecutive keyframes
  const barSegments = []
  for (let i = 0; i < track.keyframes.length - 1; i++) {
    const startKf = track.keyframes[i]
    const endKf = track.keyframes[i + 1]
    const startX = startKf.position * pixelsPerSecond
    const endX = endKf.position * pixelsPerSecond
    barSegments.push({
      id: `bar-${startKf.id}-${endKf.id}`,
      left: startX,
      width: endX - startX,
      k1: startKf,
      k2: endKf,
    })
  }

  // Render keyframe row
  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Timeline track row uses double-click for adding keyframes */}
      <div
        className={s.timelineTrackRow}
        style={{ width: timelineWidth }}
        onDoubleClick={handleDoubleClick}
      >
        {/* Bar segments between keyframes — draggable to move selected kfs; clickable to edit easing */}
        {barSegments.map(bar => (
          <KeyframeBar
            key={bar.id}
            k1={bar.k1}
            k2={bar.k2}
            left={bar.left}
            width={bar.width}
            pixelsPerSecond={pixelsPerSecond}
            sequenceLength={sequenceLength}
            fps={fps}
            selectedKeyframeIds={selectedKeyframeIds}
            onOpenPopup={handleBarClick}
          />
        ))}
        {/* Keyframe diamonds */}
        {track.keyframes.map(keyframe => (
          <KeyframeDiamond
            key={keyframe.id}
            keyframe={keyframe}
            pixelsPerSecond={pixelsPerSecond}
            sequenceLength={sequenceLength}
            fps={fps}
            isSelected={selectedKeyframeIds.has(keyframe.id)}
            selectedKeyframeIds={selectedKeyframeIds}
            onSelect={selectKeyframe}
            onOpenValuePopup={handleOpenValuePopup}
            isConnectionDropTarget={!!connectingFromMarkerId}
            onConnectionDrop={() => onKeyframeConnectionDrop?.(track.id, keyframe.id)}
          />
        ))}
      </div>
      {openPopup && (
        <CurvePopup
          trackId={track.id}
          k1={openPopup.k1}
          k2={openPopup.k2}
          anchorX={openPopup.x}
          anchorY={openPopup.y}
          applyToSelected={openPopup.applyToSelected}
          onClose={() => setOpenPopup(null)}
        />
      )}
      {openValuePopup && (
        <KeyframeValuePopup
          trackId={track.id}
          keyframe={openValuePopup.keyframe}
          anchorX={openValuePopup.x}
          anchorY={openValuePopup.y}
          onClose={() => setOpenValuePopup(null)}
        />
      )}
    </>
  )
}

// Bar segment between two keyframes — drag moves all selected keyframes; click opens curve popup
interface KeyframeBarProps {
  k1: Keyframe
  k2: Keyframe
  left: number
  width: number
  pixelsPerSecond: number
  sequenceLength: number
  fps: number
  selectedKeyframeIds: Set<string>
  onOpenPopup: (k1: Keyframe, k2: Keyframe, x: number, y: number) => void
}

function KeyframeBar({
  k1,
  k2,
  left,
  width,
  pixelsPerSecond,
  sequenceLength,
  fps,
  selectedKeyframeIds,
  onOpenPopup,
}: KeyframeBarProps) {
  const isDraggingRef = useRef(false)
  const beforeStateRef = useRef('')

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      // Always reset so click handler sees fresh state
      isDraggingRef.current = false

      // No selected keyframes — let click fall through to the popup
      if (selectedKeyframeIds.size === 0) return

      e.stopPropagation()
      e.currentTarget.setPointerCapture(e.pointerId)

      const startX = e.clientX
      beforeStateRef.current = captureTimelineState()

      const store = getTimelineStore()
      const startPositions = new Map<string, number>()
      for (const [, track] of store.tracks) {
        for (const kf of track.keyframes) {
          if (selectedKeyframeIds.has(kf.id)) {
            startPositions.set(kf.id, kf.position)
          }
        }
      }

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const deltaX = moveEvent.clientX - startX
        if (Math.abs(deltaX) < 2 && !isDraggingRef.current) return
        isDraggingRef.current = true

        // Snap the delta to the nearest frame multiple so all selected keyframes
        // stay on frame boundaries after the move.
        const snappedDelta = snapToFrame(deltaX / pixelsPerSecond, fps)
        for (const [tid, track] of store.tracks) {
          for (const kf of track.keyframes) {
            if (startPositions.has(kf.id)) {
              const origPos = startPositions.get(kf.id) ?? kf.position
              store.updateKeyframe(tid, kf.id, {
                position: Math.max(0, Math.min(sequenceLength, origPos + snappedDelta)),
              })
            }
          }
        }
      }

      const handlePointerUp = () => {
        if (isDraggingRef.current) {
          fireTimelineMutation('Move keyframes', beforeStateRef.current)
        }
        document.removeEventListener('pointermove', handlePointerMove)
        document.removeEventListener('pointerup', handlePointerUp)
      }

      document.addEventListener('pointermove', handlePointerMove)
      document.addEventListener('pointerup', handlePointerUp)
    },
    [pixelsPerSecond, sequenceLength, fps, selectedKeyframeIds]
  )

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (isDraggingRef.current) return
      e.stopPropagation()
      onOpenPopup(k1, k2, e.clientX, e.clientY)
    },
    [k1, k2, onOpenPopup]
  )

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Bar is a drag handle for selected keyframes and click target for curve popup
    <div
      className={s.timelineKeyframeBar}
      style={{ left, width }}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
    />
  )
}

// Keyframe diamond with drag support
interface KeyframeDiamondProps {
  keyframe: Keyframe
  pixelsPerSecond: number
  sequenceLength: number
  fps: number
  isSelected: boolean
  selectedKeyframeIds: Set<string>
  onSelect: (keyframeId: string, addToSelection?: boolean) => void
  onOpenValuePopup?: (keyframe: Keyframe, x: number, y: number) => void
  isConnectionDropTarget?: boolean
  onConnectionDrop?: () => void
}

function KeyframeDiamond({
  keyframe,
  pixelsPerSecond,
  sequenceLength,
  fps,
  isSelected,
  selectedKeyframeIds,
  onSelect,
  onOpenValuePopup,
  isConnectionDropTarget,
  onConnectionDrop,
}: KeyframeDiamondProps) {
  const x = keyframe.position * pixelsPerSecond
  const isDraggingRef = useRef(false)
  const beforeStateRef = useRef<string>('')
  const [isHovered, setIsHovered] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Nudge the menu back into the viewport if it overflows at right/bottom edges
  useLayoutEffect(() => {
    if (!contextMenu || !menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    let { x, y } = contextMenu
    if (rect.right > window.innerWidth) x = window.innerWidth - rect.width - 4
    if (rect.bottom > window.innerHeight) y = window.innerHeight - rect.height - 4
    if (x !== contextMenu.x || y !== contextMenu.y) setContextMenu({ x, y })
  }, [contextMenu])

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', handleKey)
    }
  }, [contextMenu])

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      e.stopPropagation() // prevent timeline scrubbing
      e.preventDefault()

      // Select this keyframe (add to selection if shift/meta/ctrl held)
      const addToSelection = e.shiftKey || e.metaKey || e.ctrlKey
      if (!isSelected || addToSelection) {
        onSelect(keyframe.id, addToSelection)
      }

      const startX = e.clientX
      const startPosition = keyframe.position
      isDraggingRef.current = false
      beforeStateRef.current = captureTimelineState()

      // Capture pointer to track drag outside element
      e.currentTarget.setPointerCapture(e.pointerId)

      // Snapshot starting positions of all selected keyframes at drag start
      const store = getTimelineStore()
      const idsToMove = selectedKeyframeIds.has(keyframe.id)
        ? selectedKeyframeIds
        : new Set([keyframe.id])
      const startPositions = new Map<string, number>()
      for (const [, track] of store.tracks) {
        for (const kf of track.keyframes) {
          if (idsToMove.has(kf.id)) {
            startPositions.set(kf.id, kf.position)
          }
        }
      }

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const deltaX = moveEvent.clientX - startX
        if (Math.abs(deltaX) < 2 && !isDraggingRef.current) return
        isDraggingRef.current = true

        const deltaTime = deltaX / pixelsPerSecond
        // Snap the lead keyframe to the nearest frame, then apply the same delta
        // to all selected keyframes so their relative positions are preserved.
        const snappedPos = snapToFrame(
          Math.max(0, Math.min(sequenceLength, startPosition + deltaTime)),
          fps
        )
        const actualDelta = snappedPos - startPosition

        for (const [tid, track] of store.tracks) {
          for (const kf of track.keyframes) {
            if (startPositions.has(kf.id)) {
              const origPos = startPositions.get(kf.id) ?? kf.position
              store.updateKeyframe(tid, kf.id, {
                position: Math.max(0, Math.min(sequenceLength, origPos + actualDelta)),
              })
            }
          }
        }
      }

      const handlePointerUp = () => {
        if (isDraggingRef.current) {
          // Fire one history entry for the whole drag gesture
          fireTimelineMutation('Move keyframe', beforeStateRef.current)
          // Note: isDraggingRef stays true so handleClick can skip popup/reselect.
          // It gets reset to false at the start of the next handlePointerDown.
        }
        document.removeEventListener('pointermove', handlePointerMove)
        document.removeEventListener('pointerup', handlePointerUp)
      }

      document.addEventListener('pointermove', handlePointerMove)
      document.addEventListener('pointerup', handlePointerUp)
    },
    [
      keyframe.id,
      keyframe.position,
      isSelected,
      onSelect,
      pixelsPerSecond,
      sequenceLength,
      fps,
      selectedKeyframeIds,
    ]
  )

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // If drag happened, don't toggle selection on click
      if (isDraggingRef.current) return
      // If completing a marker connection, don't open the value popup
      if (isConnectionDropTarget) return
      e.stopPropagation()
      const addToSelection = e.shiftKey || e.metaKey || e.ctrlKey
      onSelect(keyframe.id, addToSelection)
      // Open value editor on plain click (not modifier-augmented multi-select)
      if (!addToSelection && onOpenValuePopup) {
        const rect = e.currentTarget.getBoundingClientRect()
        onOpenValuePopup(keyframe, rect.left + rect.width / 2, rect.top)
      }
    },
    [keyframe, onSelect, onOpenValuePopup, isConnectionDropTarget]
  )

  const handlePointerUp = useCallback(() => {
    // Handle connection drop when in connection mode and hovering
    if (isConnectionDropTarget && isHovered && onConnectionDrop) {
      onConnectionDrop()
    }
  }, [isConnectionDropTarget, isHovered, onConnectionDrop])

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (!isSelected) onSelect(keyframe.id, false)
      setContextMenu({ x: e.clientX, y: e.clientY })
    },
    [isSelected, keyframe.id, onSelect]
  )

  const handleDelete = useCallback(() => {
    setContextMenu(null)
    const before = captureTimelineState()
    getTimelineStore().deleteSelectedKeyframes()
    fireTimelineMutation('Delete keyframe', before)
  }, [])

  const showDropTarget = isConnectionDropTarget && isHovered

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Keyframe diamond is a drag handle */}
      <div
        className={`${s.timelineKeyframe} ${isSelected ? s.selected : ''} ${showDropTarget ? s.dropTarget : ''}`}
        style={{ left: x }}
        onPointerDown={handlePointerDown}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onPointerEnter={() => setIsHovered(true)}
        onPointerLeave={() => setIsHovered(false)}
        onPointerUp={handlePointerUp}
        title={`${keyframe.position.toFixed(2)}s`}
      />
      {contextMenu &&
        createPortal(
          <div
            ref={menuRef}
            className={s.handleTypeMenu}
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onPointerDown={e => e.stopPropagation()}
          >
            <button type="button" onClick={handleDelete}>
              Delete keyframe
            </button>
          </div>,
          document.body
        )}
    </>
  )
}

// Narrow left chevron for previous keyframe navigation
function PrevKfChevron() {
  return (
    <svg viewBox="0 0 8 14" fill="none" aria-hidden="true">
      <path
        d="M6 2L2 7L6 12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// Narrow right chevron for next keyframe navigation
function NextKfChevron() {
  return (
    <svg viewBox="0 0 8 14" fill="none" aria-hidden="true">
      <path
        d="M2 2L6 7L2 12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// Diamond icon — filled when at a keyframe, hollow otherwise
function TrackDiamondIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 10 10" aria-hidden="true">
      <rect
        x="2.2"
        y="2.2"
        width="5.6"
        height="5.6"
        rx="0.5"
        transform="rotate(45 5 5)"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.4"
      />
    </svg>
  )
}

// Curve editor icon — small bezier curve with endpoint dots
function OpenCurveEditorIcon() {
  return (
    <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M1.5 11C4 11 4.5 3 7 3C9.5 3 10 9 12.5 9"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <circle cx="1.5" cy="11" r="1.3" fill="currentColor" />
      <circle cx="12.5" cy="9" r="1.3" fill="currentColor" />
    </svg>
  )
}
