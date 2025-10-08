import React, { useRef, useEffect, useCallback, useMemo, useState } from 'react'
import * as d3 from 'd3'

export interface Stop {
  id: string // Unique ID for each stop
  pos: number // Position (0-1)
  val: number // Value
}

interface BezierEditorProps {
  stops: Stop[]
  onChangeStops: (newStops: Stop[]) => void
  onChangeActiveStop: (id: string) => void
  width?: number
  height?: number
  padding?: number
  curveType?: 'linear' | 'basis' | 'monotoneX' | 'catmullRom'
}

const d3CurveMap = {
  linear: d3.curveLinear,
  basis: d3.curveBasis,
  monotoneX: d3.curveMonotoneX,
  catmullRom: d3.curveCatmullRom,
}

const BezierEditor: React.FC<BezierEditorProps> = ({
  stops,
  onChangeActiveStop,
  onChangeStops,
  width = 200,
  height = 100,
  padding = 20,
  curveType = 'linear',
}) => {
  const svgRef = useRef<SVGSVGElement>(null)

  const xScale = useMemo(
    () =>
      d3
        .scaleLinear()
        .domain([0, 1])
        .range([padding, width - padding]),
    [padding, width]
  )
  const yScale = useMemo(
    () =>
      d3
        .scaleLinear()
        .domain([0, 1])
        .range([height - padding, padding]),
    [padding, height]
  ) // Inverted for SVG y-axis

  const onBgClick = useCallback(
    (event: React.MouseEvent<SVGRectElement>) => {
      const [mouseX, mouseY] = d3.pointer(event)
      const newPos = xScale.invert(mouseX)
      const newVal = yScale.invert(mouseY)
      if (Number.isNaN(newPos) || Number.isNaN(newVal)) {
        return
      }
      if (newPos >= 0 && newPos <= 1) {
        const newStop: Stop = {
          id: `stop-click-${Date.now()}`,
          pos: Math.max(0, Math.min(1, newPos)),
          val: newVal,
        }
        const newStops = [...stops, newStop].sort((a, b) => a.pos - b.pos)
        onChangeStops(newStops)
      }
    },
    [xScale, yScale, stops, onChangeStops]
  )

  const onDoubleClick = useCallback(
    (event: React.MouseEvent<SVGCircleElement>) => {
      const id = event.currentTarget.id
      // Using dblclick for removal
      event.preventDefault()
      // Prevent removal of the first or last stop if there are only two stops
      if (stops.length <= 2 && (stops[0].id === id || stops[stops.length - 1].id === id)) {
        // console.log("Cannot remove first/last stop when only two stops exist.");
        return
      }
      const newStops = stops.filter(s => s.id !== id)
      onChangeStops(newStops)
    },
    [stops, onChangeStops]
  )

  const lineGenerator = useMemo(() => {
    const selectedCurve = d3CurveMap[curveType] || d3.curveLinear
    return d3
      .line<Stop>()
      .x(d => xScale(d.pos))
      .y(d => yScale(d.val))
      .curve(selectedCurve)
  }, [xScale, yScale, curveType])

  const [dragging, setDragging] = useState(false)
  const onDragStart = useCallback(
    (event: React.MouseEvent<SVGCircleElement>) => {
      onChangeActiveStop(event.currentTarget.id)
      setDragging(true)
    },
    [onChangeActiveStop]
  )

  const onDrag = useCallback(
    (event: React.MouseEvent<SVGCircleElement>) => {
      if (!dragging) return
      const id = event.currentTarget.id
      let newPos = xScale.invert(event.nativeEvent.offsetX)
      const newVal = yScale.invert(event.nativeEvent.offsetY)

      // Clamp position between 0 and 1
      newPos = Math.max(0, Math.min(1, newPos))

      // For the first and last stops, ensure they remain at pos 0 and 1 if they are
      const isFirstStop = stops.findIndex(s => s.id === id) === 0
      const isLastStop = stops.findIndex(s => s.id === id) === stops.length - 1

      if (isFirstStop && stops.length > 1) newPos = 0
      if (isLastStop && stops.length > 1) newPos = 1

      const updatedStops = stops
        .map(s => (s.id === id ? { ...s, pos: newPos, val: newVal } : s))
        .sort((a, b) => a.pos - b.pos)

      onChangeStops(updatedStops)
    },
    [dragging, xScale, yScale, stops, onChangeStops]
  )

  const onDragEnd = useCallback(
    (event: React.MouseEvent<SVGCircleElement>) => {
      setDragging(false)
    },
    [setDragging]
  )

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      style={{ display: 'block', backgroundColor: '#282c34' }}
    >
      <title>Bezier Editor</title>
      <rect
        x={padding}
        y={padding}
        width={width}
        height={height}
        fill="transparent"
        onClick={onBgClick}
      />
      <path d={lineGenerator(stops)} fill="none" stroke="steelblue" strokeWidth="1.5" />
      {stops.map(stop => (
        <circle
          key={stop.id}
          id={stop.id}
          className="stop-circle"
          cx={xScale(stop.pos)}
          cy={yScale(stop.val)}
          r={5}
          fill="skyblue"
          stroke="steelblue"
          strokeWidth="1.5"
          style={{ cursor: 'grab' }}
          onMouseDown={onDragStart}
          onMouseMove={onDrag}
          onMouseUp={onDragEnd}
          onDoubleClick={onDoubleClick}
        />
      ))}
    </svg>
  )
}

export default BezierEditor
