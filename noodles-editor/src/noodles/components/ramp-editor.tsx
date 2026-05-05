import { scaleLinear } from 'd3'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { monotoneSlopes } from '../operators'
import type { RampInterpType } from '../operators'

export interface RampStop {
  id: string
  pos: number
  val: number
  interp?: RampInterpType
}

interface RampEditorProps {
  stops: RampStop[]
  /** Called on every drag frame — no history commit. */
  onChange: (stops: RampStop[]) => void
  /** Called for structural changes (add/delete). Parent should wrap with history. */
  onStructuralChange?: (stops: RampStop[], description: string) => void
  onDragStart?: () => void
  onDragEnd?: () => void
  disabled?: boolean
  width?: number
  height?: number
  activeStopId?: string | null
  onActivate?: (id: string) => void
}

const PAD = 12

// Build an SVG path string for the ramp curve, segment by segment.
function buildRampPath(
  sortedStops: RampStop[],
  xScale: (v: number) => number,
  yScale: (v: number) => number
): string {
  if (sortedStops.length < 2) return ''

  const slopes = monotoneSlopes(sortedStops)
  const parts: string[] = [`M ${xScale(sortedStops[0].pos)} ${yScale(sortedStops[0].val)}`]

  for (let i = 0; i < sortedStops.length - 1; i++) {
    const s0 = sortedStops[i]
    const s1 = sortedStops[i + 1]
    const x1 = xScale(s1.pos)
    const y0 = yScale(s0.val)
    const y1 = yScale(s1.val)
    const interp = s0.interp ?? 'smooth'

    if (interp === 'hold') {
      parts.push(`L ${x1} ${y0} L ${x1} ${y1}`)
    } else if (interp === 'smooth') {
      const h = s1.pos - s0.pos
      const cp1x = xScale(s0.pos + h / 3)
      const cp1y = yScale(s0.val + slopes[i] * (h / 3))
      const cp2x = xScale(s1.pos - h / 3)
      const cp2y = yScale(s1.val - slopes[i + 1] * (h / 3))
      parts.push(`C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${x1} ${y1}`)
    } else {
      parts.push(`L ${x1} ${y1}`)
    }
  }

  return parts.join(' ')
}

export default function RampEditor({
  stops: stopsProp,
  onChange,
  onStructuralChange,
  onDragStart,
  onDragEnd,
  disabled = false,
  width = 220,
  height = 100,
  activeStopId,
  onActivate,
}: RampEditorProps) {
  const stops = stopsProp.length > 0 ? stopsProp : []

  const xScale = useMemo(
    () =>
      scaleLinear()
        .domain([0, 1])
        .range([PAD, width - PAD]),
    [width]
  )

  const yScale = useMemo(
    () =>
      scaleLinear()
        .domain([0, 1])
        .range([height - PAD, PAD]),
    [height]
  )

  const svgRef = useRef<SVGSVGElement>(null)
  const stopsRef = useRef(stops)
  useEffect(() => {
    stopsRef.current = stops
  })

  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    stopId: string
    x: number
    y: number
  } | null>(null)
  // Suppress the second click of a double-click (which would add two stops)
  const lastClickTimeRef = useRef(0)

  // Close context menu on outside mousedown
  useEffect(() => {
    if (!contextMenu) return
    const handle = () => setContextMenu(null)
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [contextMenu])

  const handleBgClick = useCallback(
    (e: React.MouseEvent<SVGRectElement>) => {
      if (disabled) return
      const now = Date.now()
      if (now - lastClickTimeRef.current < 300) return
      lastClickTimeRef.current = now
      const rect = svgRef.current!.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const pos = Math.max(0, Math.min(1, xScale.invert(x)))
      const val = Math.max(0, Math.min(1, yScale.invert(y)))
      const newStop: RampStop = { id: crypto.randomUUID(), pos, val, interp: 'smooth' }
      const newStops = [...stopsRef.current, newStop].sort((a, b) => a.pos - b.pos)
      onStructuralChange?.(newStops, 'Add ramp stop')
    },
    [disabled, xScale, yScale, onStructuralChange]
  )

  const handleStopMouseDown = useCallback(
    (e: React.MouseEvent<SVGCircleElement>, stopId: string) => {
      if (disabled) return
      e.stopPropagation()
      onActivate?.(stopId)
      onDragStart?.()

      const sorted = [...stopsRef.current].sort((a, b) => a.pos - b.pos)
      const isFirst = sorted[0]?.id === stopId
      const isLast = sorted[sorted.length - 1]?.id === stopId

      // Capture scales at drag start — avoids jank when y-axis auto-rescales during drag
      const capturedXScale = xScale.copy()
      const capturedYScale = yScale.copy()
      setDraggingId(stopId)

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (!svgRef.current) return
        const rect = svgRef.current.getBoundingClientRect()
        const x = moveEvent.clientX - rect.left
        const y = moveEvent.clientY - rect.top
        const newPos = isFirst ? 0 : isLast ? 1 : Math.max(0, Math.min(1, capturedXScale.invert(x)))
        const newVal = Math.max(0, Math.min(1, capturedYScale.invert(y)))
        const updated = stopsRef.current
          .map(s => (s.id === stopId ? { ...s, pos: newPos, val: newVal } : s))
          .sort((a, b) => a.pos - b.pos)
        onChange(updated)
      }

      const onMouseUp = () => {
        setDraggingId(null)
        onDragEnd?.()
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [disabled, xScale, yScale, onChange, onActivate, onDragStart, onDragEnd]
  )

  const handleStopContextMenu = useCallback((e: React.MouseEvent, stopId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ stopId, x: e.clientX, y: e.clientY })
  }, [])

  const handleContextMenuDelete = useCallback(() => {
    if (!contextMenu) return
    const current = stopsRef.current
    if (current.length <= 2) return
    onStructuralChange?.(
      current.filter(s => s.id !== contextMenu.stopId),
      'Delete ramp stop'
    )
    setContextMenu(null)
  }, [contextMenu, onStructuralChange])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (!activeStopId) return
      const current = stopsRef.current
      if (current.length <= 2) return
      e.preventDefault()
      onStructuralChange?.(
        current.filter(s => s.id !== activeStopId),
        'Delete ramp stop'
      )
    },
    [activeStopId, onStructuralChange]
  )

  const sortedStops = useMemo(() => [...stops].sort((a, b) => a.pos - b.pos), [stops])
  const pathD = useMemo(
    () => buildRampPath(sortedStops, xScale, yScale),
    [sortedStops, xScale, yScale]
  )

  return (
    <>
      {/* biome-ignore lint/a11y/noSvgWithoutTitle: interactive SVG editor */}
      <svg
        ref={svgRef}
        width={width}
        height={height}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        style={{
          display: 'block',
          background: '#1a1d22',
          borderRadius: 3,
          cursor: disabled ? 'default' : 'crosshair',
          userSelect: 'none',
          outline: 'none',
        }}
      >
        {/* Clickable background to add stops */}
        <rect
          x={0}
          y={0}
          width={width}
          height={height}
          fill="transparent"
          onClick={handleBgClick}
        />
        {sortedStops.length >= 2 && (
          <path d={pathD} fill="none" stroke="#3b82f6" strokeWidth={1.5} />
        )}
        {sortedStops.map(stop => (
          <g key={stop.id}>
            {/* Large transparent hit area */}
            <circle
              cx={xScale(stop.pos)}
              cy={yScale(stop.val)}
              r={8}
              fill="transparent"
              style={{
                cursor: disabled ? 'default' : draggingId === stop.id ? 'grabbing' : 'grab',
              }}
              onMouseDown={e => handleStopMouseDown(e, stop.id)}
              onContextMenu={e => handleStopContextMenu(e, stop.id)}
            />
            {/* Visible control point */}
            <circle
              cx={xScale(stop.pos)}
              cy={yScale(stop.val)}
              r={activeStopId === stop.id ? 5 : 4}
              fill={
                activeStopId === stop.id
                  ? '#ffffff'
                  : draggingId === stop.id
                    ? '#60a5fa'
                    : '#3b82f6'
              }
              stroke={activeStopId === stop.id ? '#3b82f6' : '#1e3a8a'}
              strokeWidth={1.5}
              pointerEvents="none"
            />
          </g>
        ))}
      </svg>
      {contextMenu &&
        createPortal(
          // biome-ignore lint/a11y/noStaticElementInteractions: context menu
          <div
            style={{
              position: 'fixed',
              left: contextMenu.x,
              top: contextMenu.y,
              zIndex: 9999,
              background: 'linear-gradient(180deg, #1e2634 0%, #171d27 100%)',
              border: '1px solid #2f3b4c',
              borderRadius: 4,
              padding: 4,
              minWidth: 120,
              boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
            }}
            onMouseDown={e => e.stopPropagation()}
          >
            <button
              type="button"
              style={{
                display: 'block',
                width: '100%',
                padding: '6px 10px',
                textAlign: 'left',
                background: 'none',
                border: 'none',
                borderRadius: 2,
                color: stopsRef.current.length <= 2 ? 'rgba(226,222,222,0.3)' : '#e2dede',
                cursor: stopsRef.current.length <= 2 ? 'not-allowed' : 'pointer',
                fontSize: '0.875em',
              }}
              disabled={stopsRef.current.length <= 2}
              onClick={handleContextMenuDelete}
            >
              Delete stop
            </button>
          </div>,
          document.body
        )}
    </>
  )
}
