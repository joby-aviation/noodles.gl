// Bezier curve editor for keyframe easing visualization and editing

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BezierHandles, Keyframe, Track } from '../types'
import { evaluateCubicBezier, findTForX } from '../interpolation'
import { EASING_PRESETS, findMatchingPreset } from '../easing-presets'
import { useTimelineStore } from '../timeline-store'

export interface CurveEditorProps {
  trackId: string
  width?: number
  height?: number
  showGrid?: boolean
  showPresets?: boolean
}

interface Point {
  x: number
  y: number
}

// Convert normalized coordinates to pixel coordinates
function toPixel(point: Point, width: number, height: number, padding: number): Point {
  return {
    x: padding + point.x * (width - padding * 2),
    y: height - padding - point.y * (height - padding * 2),
  }
}

// Convert pixel coordinates to normalized coordinates
function toNormalized(pixel: Point, width: number, height: number, padding: number): Point {
  return {
    x: (pixel.x - padding) / (width - padding * 2),
    y: (height - padding - pixel.y) / (height - padding * 2),
  }
}

// Generate bezier curve path for SVG
function generateCurvePath(
  handles: BezierHandles,
  width: number,
  height: number,
  padding: number
): string {
  const p0 = toPixel({ x: 0, y: 0 }, width, height, padding)
  const p1 = toPixel({ x: handles.left[0], y: handles.left[1] }, width, height, padding)
  const p2 = toPixel({ x: handles.right[0], y: handles.right[1] }, width, height, padding)
  const p3 = toPixel({ x: 1, y: 1 }, width, height, padding)

  return `M ${p0.x} ${p0.y} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`
}

// Generate preview path showing the curve shape
function generatePreviewPath(
  handles: BezierHandles,
  width: number,
  height: number,
  padding: number,
  steps: number = 50
): string {
  const points: Point[] = []

  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const x = evaluateCubicBezier(t, 0, handles.left[0], handles.right[0], 1)
    const y = evaluateCubicBezier(t, 0, handles.left[1], handles.right[1], 1)
    points.push(toPixel({ x, y }, width, height, padding))
  }

  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
}

// Grid component
function Grid({ width, height, padding }: { width: number; height: number; padding: number }) {
  const gridLines: React.ReactElement[] = []
  const divisions = 4

  // Vertical lines
  for (let i = 0; i <= divisions; i++) {
    const x = padding + (i / divisions) * (width - padding * 2)
    gridLines.push(
      <line
        key={`v-${i}`}
        x1={x}
        y1={padding}
        x2={x}
        y2={height - padding}
        stroke="#333"
        strokeWidth={i === 0 || i === divisions ? 1 : 0.5}
      />
    )
  }

  // Horizontal lines
  for (let i = 0; i <= divisions; i++) {
    const y = padding + (i / divisions) * (height - padding * 2)
    gridLines.push(
      <line
        key={`h-${i}`}
        x1={padding}
        y1={y}
        x2={width - padding}
        y2={y}
        stroke="#333"
        strokeWidth={i === 0 || i === divisions ? 1 : 0.5}
      />
    )
  }

  return <g className="curve-editor-grid">{gridLines}</g>
}

// Handle control point component
interface HandleProps {
  position: Point
  onDrag: (delta: Point) => void
  color: string
  isActive: boolean
  onDragStart: () => void
  onDragEnd: () => void
}

function Handle({ position, onDrag, color, isActive, onDragStart, onDragEnd }: HandleProps) {
  const handleRef = useRef<SVGCircleElement>(null)

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation()
      e.preventDefault()
      onDragStart()

      const startX = e.clientX
      const startY = e.clientY

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const deltaX = moveEvent.clientX - startX
        const deltaY = moveEvent.clientY - startY
        onDrag({ x: deltaX, y: deltaY })
      }

      const handlePointerUp = () => {
        document.removeEventListener('pointermove', handlePointerMove)
        document.removeEventListener('pointerup', handlePointerUp)
        onDragEnd()
      }

      document.addEventListener('pointermove', handlePointerMove)
      document.addEventListener('pointerup', handlePointerUp)
    },
    [onDrag, onDragStart, onDragEnd]
  )

  return (
    <circle
      ref={handleRef}
      cx={position.x}
      cy={position.y}
      r={isActive ? 8 : 6}
      fill={isActive ? color : '#1a1a1a'}
      stroke={color}
      strokeWidth={2}
      style={{ cursor: 'grab' }}
      onPointerDown={handlePointerDown}
    />
  )
}

// Preset button component
interface PresetButtonProps {
  name: string
  handles: BezierHandles
  isSelected: boolean
  onClick: () => void
}

function PresetButton({ name, handles, isSelected, onClick }: PresetButtonProps) {
  const previewPath = useMemo(() => generatePreviewPath(handles, 40, 30, 4, 20), [handles])

  return (
    <button
      className={`curve-editor-preset ${isSelected ? 'selected' : ''}`}
      onClick={onClick}
      title={name}
    >
      <svg width={40} height={30}>
        <path d={previewPath} fill="none" stroke={isSelected ? '#4a9eff' : '#666'} strokeWidth={1.5} />
      </svg>
    </button>
  )
}

export function CurveEditor({
  trackId,
  width = 300,
  height = 200,
  showGrid = true,
  showPresets = true,
}: CurveEditorProps) {
  const padding = 20
  const svgRef = useRef<SVGSVGElement>(null)

  const [activeHandle, setActiveHandle] = useState<'left' | 'right' | null>(null)
  const [dragStartHandles, setDragStartHandles] = useState<BezierHandles | null>(null)

  const track = useTimelineStore((state) => state.tracks.get(trackId))
  const selectedKeyframeIds = useTimelineStore((state) => state.selectedKeyframeIds)
  const setKeyframeHandles = useTimelineStore((state) => state.setKeyframeHandles)

  // Find selected keyframe in this track
  const selectedKeyframe = useMemo(() => {
    if (!track) return null
    return track.keyframes.find((kf) => selectedKeyframeIds.has(kf.id)) ?? null
  }, [track, selectedKeyframeIds])

  // Current handles to display
  const handles: BezierHandles = useMemo(() => {
    if (selectedKeyframe?.handles) {
      return selectedKeyframe.handles
    }
    // Default linear handles
    return { left: [0.33, 0.33], right: [0.67, 0.67], type: 'aligned' }
  }, [selectedKeyframe])

  // Convert handles to pixel positions
  const leftHandlePixel = useMemo(
    () => toPixel({ x: handles.left[0], y: handles.left[1] }, width, height, padding),
    [handles, width, height]
  )

  const rightHandlePixel = useMemo(
    () => toPixel({ x: handles.right[0], y: handles.right[1] }, width, height, padding),
    [handles, width, height]
  )

  // Start and end keyframe positions in pixels
  const startPoint = useMemo(() => toPixel({ x: 0, y: 0 }, width, height, padding), [width, height])
  const endPoint = useMemo(() => toPixel({ x: 1, y: 1 }, width, height, padding), [width, height])

  // Generate curve path
  const curvePath = useMemo(
    () => generatePreviewPath(handles, width, height, padding),
    [handles, width, height]
  )

  // Find matching preset
  const matchingPreset = useMemo(() => findMatchingPreset(handles), [handles])

  // Handle drag for left control point
  const handleLeftDrag = useCallback(
    (delta: Point) => {
      if (!selectedKeyframe || !dragStartHandles) return

      const pixelToNormalDelta = {
        x: delta.x / (width - padding * 2),
        y: -delta.y / (height - padding * 2),
      }

      let newLeft: [number, number] = [
        Math.max(0, Math.min(1, dragStartHandles.left[0] + pixelToNormalDelta.x)),
        dragStartHandles.left[1] + pixelToNormalDelta.y,
      ]

      let newRight = dragStartHandles.right

      // For aligned handles, mirror the movement
      if (handles.type === 'aligned') {
        const angle = Math.atan2(newLeft[1], newLeft[0])
        const rightLength = Math.sqrt(
          dragStartHandles.right[0] ** 2 + dragStartHandles.right[1] ** 2
        )
        newRight = [
          Math.max(0, Math.min(1, 1 - rightLength * Math.cos(angle + Math.PI))),
          1 - rightLength * Math.sin(angle + Math.PI),
        ]
      }

      setKeyframeHandles(trackId, selectedKeyframe.id, {
        left: newLeft,
        right: newRight,
        type: handles.type,
      })
    },
    [selectedKeyframe, dragStartHandles, width, height, padding, handles.type, trackId, setKeyframeHandles]
  )

  // Handle drag for right control point
  const handleRightDrag = useCallback(
    (delta: Point) => {
      if (!selectedKeyframe || !dragStartHandles) return

      const pixelToNormalDelta = {
        x: delta.x / (width - padding * 2),
        y: -delta.y / (height - padding * 2),
      }

      let newRight: [number, number] = [
        Math.max(0, Math.min(1, dragStartHandles.right[0] + pixelToNormalDelta.x)),
        dragStartHandles.right[1] + pixelToNormalDelta.y,
      ]

      let newLeft = dragStartHandles.left

      // For aligned handles, mirror the movement
      if (handles.type === 'aligned') {
        const angle = Math.atan2(newRight[1] - 1, newRight[0] - 1)
        const leftLength = Math.sqrt(dragStartHandles.left[0] ** 2 + dragStartHandles.left[1] ** 2)
        newLeft = [
          Math.max(0, Math.min(1, leftLength * Math.cos(angle + Math.PI))),
          leftLength * Math.sin(angle + Math.PI),
        ]
      }

      setKeyframeHandles(trackId, selectedKeyframe.id, {
        left: newLeft,
        right: newRight,
        type: handles.type,
      })
    },
    [selectedKeyframe, dragStartHandles, width, height, padding, handles.type, trackId, setKeyframeHandles]
  )

  const handleDragStart = useCallback(
    (handle: 'left' | 'right') => {
      setActiveHandle(handle)
      setDragStartHandles({ ...handles })
    },
    [handles]
  )

  const handleDragEnd = useCallback(() => {
    setActiveHandle(null)
    setDragStartHandles(null)
  }, [])

  // Apply preset
  const applyPreset = useCallback(
    (preset: (typeof EASING_PRESETS)[number]) => {
      if (!selectedKeyframe) return
      setKeyframeHandles(trackId, selectedKeyframe.id, preset.handles)
    },
    [selectedKeyframe, trackId, setKeyframeHandles]
  )

  if (!track) {
    return (
      <div className="curve-editor curve-editor-empty" style={{ width, height }}>
        <span>No track selected</span>
      </div>
    )
  }

  if (!selectedKeyframe) {
    return (
      <div className="curve-editor curve-editor-empty" style={{ width, height }}>
        <span>Select a keyframe to edit its curve</span>
      </div>
    )
  }

  return (
    <div className="curve-editor" style={{ width }}>
      <svg ref={svgRef} width={width} height={height} className="curve-editor-canvas">
        {/* Background */}
        <rect x={0} y={0} width={width} height={height} fill="#1a1a1a" />

        {/* Grid */}
        {showGrid && <Grid width={width} height={height} padding={padding} />}

        {/* Handle lines */}
        <line
          x1={startPoint.x}
          y1={startPoint.y}
          x2={leftHandlePixel.x}
          y2={leftHandlePixel.y}
          stroke="#666"
          strokeWidth={1}
          strokeDasharray="4 2"
        />
        <line
          x1={endPoint.x}
          y1={endPoint.y}
          x2={rightHandlePixel.x}
          y2={rightHandlePixel.y}
          stroke="#666"
          strokeWidth={1}
          strokeDasharray="4 2"
        />

        {/* Curve */}
        <path d={curvePath} fill="none" stroke="#4a9eff" strokeWidth={2} />

        {/* Keyframe points */}
        <circle cx={startPoint.x} cy={startPoint.y} r={5} fill="#4a9eff" />
        <circle cx={endPoint.x} cy={endPoint.y} r={5} fill="#4a9eff" />

        {/* Handle control points */}
        <Handle
          position={leftHandlePixel}
          onDrag={handleLeftDrag}
          color="#ff6b6b"
          isActive={activeHandle === 'left'}
          onDragStart={() => handleDragStart('left')}
          onDragEnd={handleDragEnd}
        />
        <Handle
          position={rightHandlePixel}
          onDrag={handleRightDrag}
          color="#51cf66"
          isActive={activeHandle === 'right'}
          onDragStart={() => handleDragStart('right')}
          onDragEnd={handleDragEnd}
        />
      </svg>

      {/* Preset selector */}
      {showPresets && (
        <div className="curve-editor-presets">
          {EASING_PRESETS.slice(0, 10).map((preset) => (
            <PresetButton
              key={preset.name}
              name={preset.name}
              handles={preset.handles}
              isSelected={matchingPreset?.name === preset.name}
              onClick={() => applyPreset(preset)}
            />
          ))}
        </div>
      )}

      {/* Current preset name */}
      <div className="curve-editor-preset-name">
        {matchingPreset ? matchingPreset.name : 'Custom'}
      </div>
    </div>
  )
}
