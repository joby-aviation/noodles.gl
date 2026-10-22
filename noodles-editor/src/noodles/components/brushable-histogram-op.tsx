import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import type { NodeProps as ReactFlowNodeProps } from '@xyflow/react'
import cx from 'classnames'
import { max as d3Max, scaleLinear } from 'd3'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

import { analytics } from '../../utils/analytics'
import { debugUI } from '../../utils/debug'
import type { Field, IField } from '../fields'
import { useObservable } from '../hooks/use-observable'
import s from '../noodles.module.css'
import type { BrushableHistogramOp, IOperator, Operator } from '../operators'
import { getOp } from '../store'
import type { NodeDataJSON } from '../transform-graph'
import { usePropertyHistory } from '../utils/property-history'
import styles from './brushable-histogram.module.css'
import { FieldComponent } from './field-components'
import {
  NodeHeader,
  OutputHandle,
  PAR_HANDLE_OPTIONS,
  useFieldVisibility,
  useLocked,
  useNodeDimmed,
} from './op-components'

type Bin = { x0: number; x1: number; count: number }
type BrushHandle = 'min' | 'max'

const EMPTY_BINS: Bin[] = []
const DEFAULT_EXTENT: [number, number] = [0, 100]

// Histogram dimensions
const WIDTH = 700
const HEIGHT = 300
const MARGIN = { top: 20, right: 20, bottom: 40, left: 50 }
const CHART_WIDTH = WIDTH - MARGIN.left - MARGIN.right
const CHART_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom

// Arrow keys move a handle by 1% of the extent; Shift or PageUp/PageDown by 10%
const KEYBOARD_STEPS = 100
const LARGE_STEP_MULTIPLIER = 10

interface HistogramDialogProps {
  op: Operator<BrushableHistogramOp>
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function BrushableHistogramDialog({ op, open, onOpenChange }: HistogramDialogProps) {
  debugUI('BrushableHistogramDialog render open=%s op=%s', open, op.id)

  const svgRef = useRef<SVGSVGElement>(null)
  const [isDragging, setIsDragging] = useState<BrushHandle | null>(null)
  const { captureStart, commitChange } = usePropertyHistory()
  const idPrefix = useId()
  const modeId = `${idPrefix}-mode`
  const centerId = `${idPrefix}-center`
  const widthId = `${idPrefix}-width`
  const minId = `${idPrefix}-min`
  const maxId = `${idPrefix}-max`

  // Subscribe to the fields so the dialog re-renders on drag, keyboard input and execution
  const binData = (useObservable(op.outputs.binData, op.outputs.binData.value) ??
    EMPTY_BINS) as Bin[]
  const extent = (useObservable(op.outputs.extent, op.outputs.extent.value) ?? DEFAULT_EXTENT) as [
    number,
    number,
  ]
  const filteredData = useObservable(op.outputs.filteredData, op.outputs.filteredData.value)
  const data = useObservable(op.inputs.data, op.inputs.data.value)
  const field = useObservable(op.inputs.field, op.inputs.field.value) as string
  const brushMin = useObservable(op.inputs.brushMin, op.inputs.brushMin.value) as number
  const brushMax = useObservable(op.inputs.brushMax, op.inputs.brushMax.value) as number
  const brushMode = useObservable(op.inputs.brushMode, op.inputs.brushMode.value) as
    | 'handles'
    | 'offset'

  // Derived state for offset mode
  const brushCenter = (brushMin + brushMax) / 2
  const brushWidth = brushMax - brushMin

  const xScale = useMemo(() => scaleLinear().domain(extent).range([0, CHART_WIDTH]), [extent])
  const maxCount = useMemo(() => d3Max(binData, d => d.count) ?? 0, [binData])
  const yScale = useMemo(
    () => scaleLinear().domain([0, maxCount]).range([CHART_HEIGHT, 0]),
    [maxCount]
  )

  // The dialog is opened by the node's button, which Radix does not report through
  // onOpenChange, so start the undo snapshot whenever `open` turns true
  useEffect(() => {
    if (!open) return
    captureStart()
    analytics.track('brushable_histogram_opened')
  }, [open, captureStart])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) commitChange('Adjust histogram brush')
      onOpenChange(nextOpen)
    },
    [commitChange, onOpenChange]
  )

  // Moves one handle, clamped to the extent and to the other handle
  const setHandleValue = useCallback(
    (handle: BrushHandle, value: number) => {
      const clamped = Math.max(extent[0], Math.min(extent[1], value))
      if (handle === 'min') {
        op.inputs.brushMin.setValue(Math.min(clamped, op.inputs.brushMax.value as number))
      } else {
        op.inputs.brushMax.setValue(Math.max(clamped, op.inputs.brushMin.value as number))
      }
    },
    [extent, op]
  )

  // Drag a handle with the mouse. Each drag is its own undo step.
  const handleMouseDown = useCallback(
    (handle: BrushHandle, e: React.MouseEvent) => {
      e.preventDefault()
      setIsDragging(handle)
      commitChange('Adjust histogram brush')
      captureStart()

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (!svgRef.current) return
        // The SVG scales to fit narrow windows, so convert screen pixels to viewBox units
        const rect = svgRef.current.getBoundingClientRect()
        const x = ((moveEvent.clientX - rect.left) * WIDTH) / rect.width - MARGIN.left
        setHandleValue(handle, xScale.invert(x))
      }

      const onMouseUp = () => {
        setIsDragging(null)
        commitChange('Adjust brush handle')
        captureStart()
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [xScale, setHandleValue, captureStart, commitChange]
  )

  // Keyboard control for the handles, following the ARIA slider pattern
  const handleKeyDown = useCallback(
    (handle: BrushHandle, e: React.KeyboardEvent) => {
      const step = (extent[1] - extent[0]) / KEYBOARD_STEPS || 1
      const largeStep = step * LARGE_STEP_MULTIPLIER
      const current = handle === 'min' ? brushMin : brushMax
      const delta = e.shiftKey ? largeStep : step
      let next: number
      switch (e.key) {
        case 'ArrowLeft':
        case 'ArrowDown':
          next = current - delta
          break
        case 'ArrowRight':
        case 'ArrowUp':
          next = current + delta
          break
        case 'PageDown':
          next = current - largeStep
          break
        case 'PageUp':
          next = current + largeStep
          break
        case 'Home':
          next = extent[0]
          break
        case 'End':
          next = extent[1]
          break
        default:
          return
      }
      e.preventDefault()
      setHandleValue(handle, next)
    },
    [extent, brushMin, brushMax, setHandleValue]
  )

  // Handle offset mode controls
  const handleCenterChange = useCallback(
    (newCenter: number) => {
      // Stop the center where the brush meets the extent, so moving it never changes the width
      const halfWidth = Math.min(brushWidth, extent[1] - extent[0]) / 2
      const center = Math.max(extent[0] + halfWidth, Math.min(extent[1] - halfWidth, newCenter))
      op.inputs.brushMin.setValue(center - halfWidth)
      op.inputs.brushMax.setValue(center + halfWidth)
    },
    [brushWidth, extent, op]
  )

  const handleWidthChange = useCallback(
    (newWidth: number) => {
      const halfWidth = newWidth / 2
      let minVal = brushCenter - halfWidth
      let maxVal = brushCenter + halfWidth

      // Clamp to extent
      if (minVal < extent[0]) {
        minVal = extent[0]
        maxVal = Math.min(extent[1], minVal + newWidth)
      }
      if (maxVal > extent[1]) {
        maxVal = extent[1]
        minVal = Math.max(extent[0], maxVal - newWidth)
      }

      op.inputs.brushMin.setValue(minVal)
      op.inputs.brushMax.setValue(maxVal)
    },
    [brushCenter, extent, op]
  )

  const handleModeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      op.inputs.brushMode.setValue(e.target.value as 'handles' | 'offset')
    },
    [op]
  )

  const renderHandle = (handle: BrushHandle) => {
    const value = handle === 'min' ? brushMin : brushMax
    const x = xScale(value)
    return (
      <g
        role="slider"
        tabIndex={0}
        aria-label={handle === 'min' ? 'Brush minimum' : 'Brush maximum'}
        aria-orientation="horizontal"
        aria-valuemin={handle === 'min' ? extent[0] : brushMin}
        aria-valuemax={handle === 'min' ? brushMax : extent[1]}
        aria-valuenow={value}
        aria-valuetext={value.toFixed(2)}
        className={cx(styles.brushHandle, isDragging === handle && styles.dragging)}
        onMouseDown={e => handleMouseDown(handle, e)}
        onKeyDown={e => handleKeyDown(handle, e)}
      >
        <line x1={x} y1={0} x2={x} y2={CHART_HEIGHT} className={styles.handleLine} />
        <circle cx={x} cy={CHART_HEIGHT / 2} r={6} className={styles.handleCircle} />
      </g>
    )
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Content
          className={styles.content}
          onPointerDownOutside={e => e.preventDefault()}
          onInteractOutside={e => e.preventDefault()}
        >
          <Dialog.Title className={styles.title}>Brushable Histogram</Dialog.Title>
          <Dialog.Close asChild>
            <button type="button" className={styles.closeButton} aria-label="Close">
              <Cross2Icon />
            </button>
          </Dialog.Close>

          {binData.length === 0 ? (
            <div className={styles.emptyState}>
              No data to display. Connect data and select a field to visualize.
            </div>
          ) : (
            <>
              <div className={styles.controls}>
                <div className={styles.controlRow}>
                  <label htmlFor={modeId} className={styles.label}>
                    Mode
                  </label>
                  <select
                    id={modeId}
                    className={styles.select}
                    value={brushMode}
                    onChange={handleModeChange}
                  >
                    <option value="handles">Handles</option>
                    <option value="offset">Offset</option>
                  </select>
                </div>

                {brushMode === 'offset' ? (
                  <>
                    <div className={styles.controlRow}>
                      <label htmlFor={centerId} className={styles.label}>
                        Center
                      </label>
                      <input
                        id={centerId}
                        type="range"
                        className={styles.slider}
                        min={extent[0]}
                        max={extent[1]}
                        step={(extent[1] - extent[0]) / 1000}
                        value={brushCenter}
                        onChange={e => handleCenterChange(parseFloat(e.target.value))}
                      />
                      <span className={styles.value}>{brushCenter.toFixed(2)}</span>
                    </div>
                    <div className={styles.controlRow}>
                      <label htmlFor={widthId} className={styles.label}>
                        Width
                      </label>
                      <input
                        id={widthId}
                        type="range"
                        className={styles.slider}
                        min={0}
                        max={extent[1] - extent[0]}
                        step={(extent[1] - extent[0]) / 1000}
                        value={brushWidth}
                        onChange={e => handleWidthChange(parseFloat(e.target.value))}
                      />
                      <span className={styles.value}>{brushWidth.toFixed(2)}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className={styles.controlRow}>
                      <label htmlFor={minId} className={styles.label}>
                        Min
                      </label>
                      <input
                        id={minId}
                        type="number"
                        className={styles.input}
                        value={brushMin.toFixed(2)}
                        onChange={e => {
                          const val = parseFloat(e.target.value)
                          if (!Number.isNaN(val)) {
                            op.inputs.brushMin.setValue(Math.min(val, brushMax))
                          }
                        }}
                      />
                    </div>
                    <div className={styles.controlRow}>
                      <label htmlFor={maxId} className={styles.label}>
                        Max
                      </label>
                      <input
                        id={maxId}
                        type="number"
                        className={styles.input}
                        value={brushMax.toFixed(2)}
                        onChange={e => {
                          const val = parseFloat(e.target.value)
                          if (!Number.isNaN(val)) {
                            op.inputs.brushMax.setValue(Math.max(val, brushMin))
                          }
                        }}
                      />
                    </div>
                  </>
                )}
              </div>

              <div className={styles.chartContainer}>
                <svg
                  ref={svgRef}
                  width={WIDTH}
                  height={HEIGHT}
                  viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                  className={styles.svg}
                >
                  <title>
                    {`Histogram of ${field || 'values'}, brushed from ${brushMin.toFixed(2)} to ${brushMax.toFixed(2)}`}
                  </title>
                  <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
                    {/* Histogram bars */}
                    {binData.map(bin => {
                      const x = xScale(bin.x0 ?? 0)
                      const barWidth = xScale(bin.x1 ?? 0) - x
                      const y = yScale(bin.count)
                      const barHeight = CHART_HEIGHT - y

                      return (
                        <rect
                          key={`${bin.x0}-${bin.x1}`}
                          x={x}
                          y={y}
                          width={Math.max(0, barWidth - 1)}
                          height={barHeight}
                          className={styles.bar}
                        />
                      )
                    })}

                    {/* Brush overlay */}
                    <rect
                      x={xScale(brushMin)}
                      y={0}
                      width={xScale(brushMax) - xScale(brushMin)}
                      height={CHART_HEIGHT}
                      className={styles.brushOverlay}
                    />

                    {/* Brush handles */}
                    {renderHandle('min')}
                    {renderHandle('max')}

                    {/* X axis */}
                    <g transform={`translate(0,${CHART_HEIGHT})`}>
                      <line x1={0} y1={0} x2={CHART_WIDTH} y2={0} className={styles.axis} />
                      <text x={0} y={20} className={styles.axisLabel}>
                        {extent[0].toFixed(1)}
                      </text>
                      <text x={CHART_WIDTH} y={20} textAnchor="end" className={styles.axisLabel}>
                        {extent[1].toFixed(1)}
                      </text>
                    </g>

                    {/* Y axis */}
                    <g>
                      <line x1={0} y1={0} x2={0} y2={CHART_HEIGHT} className={styles.axis} />
                      <text x={-10} y={0} textAnchor="end" className={styles.axisLabel}>
                        {maxCount.toFixed(0)}
                      </text>
                    </g>
                  </g>
                </svg>
              </div>

              <div className={styles.info}>
                Filtered: {(filteredData as unknown[] | undefined)?.length ?? 0} /{' '}
                {(data as unknown[] | undefined)?.length ?? 0} items
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// Outer shell: checks op existence before any hooks fire
export function BrushableHistogramOpComponent(
  props: ReactFlowNodeProps<NodeDataJSON<BrushableHistogramOp>> & {
    type: 'BrushableHistogramOp'
  }
) {
  debugUI('BrushableHistogramOpComponent render id=%s', props.id)
  const op = getOp(props.id as string)
  if (!op) {
    debugUI('BrushableHistogramOpComponent op not found yet for id=%s', props.id)
    return null
  }
  return <BrushableHistogramOpInner {...props} op={op as Operator<BrushableHistogramOp>} />
}

function BrushableHistogramOpInner({
  id,
  type,
  op,
}: ReactFlowNodeProps<NodeDataJSON<BrushableHistogramOp>> & {
  type: 'BrushableHistogramOp'
  op: Operator<BrushableHistogramOp>
}) {
  debugUI('BrushableHistogramOpInner render id=%s', id)
  const isDimmed = useNodeDimmed(id)
  const locked = useLocked(op as Operator<IOperator>)
  const [dialogOpen, setDialogOpen] = useState(false)
  useFieldVisibility(op as Operator<IOperator>)

  return (
    <div className={cx(s.wrapper, { [s.wrapperDimmed]: isDimmed })}>
      <NodeHeader id={id} type={type} op={op as Operator<IOperator>} />
      <div className={s.content}>
        <FieldComponent
          id="data"
          field={op.inputs.data as Field<IField>}
          disabled={locked}
          handle={PAR_HANDLE_OPTIONS}
        />
        <FieldComponent
          id="field"
          field={op.inputs.field as Field<IField>}
          disabled={locked}
          handle={PAR_HANDLE_OPTIONS}
        />
        <FieldComponent
          id="binCount"
          field={op.inputs.binCount as Field<IField>}
          disabled={locked}
          handle={PAR_HANDLE_OPTIONS}
        />
        <FieldComponent
          id="brushMin"
          field={op.inputs.brushMin as Field<IField>}
          disabled={locked}
          handle={PAR_HANDLE_OPTIONS}
        />
        <FieldComponent
          id="brushMax"
          field={op.inputs.brushMax as Field<IField>}
          disabled={locked}
          handle={PAR_HANDLE_OPTIONS}
        />
        <button
          type="button"
          className={s.configureButton}
          onClick={() => setDialogOpen(true)}
          disabled={locked}
        >
          Configure Histogram
        </button>
        <div className={s.outputHandleContainer}>
          <OutputHandle id="filteredData" field={op.outputs.filteredData as Field<IField>} />
          <OutputHandle id="binData" field={op.outputs.binData as Field<IField>} />
          <OutputHandle id="extent" field={op.outputs.extent as Field<IField>} />
        </div>
      </div>
      <BrushableHistogramDialog op={op} open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  )
}
