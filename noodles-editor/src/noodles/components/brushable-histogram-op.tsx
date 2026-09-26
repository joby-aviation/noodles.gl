import * as Dialog from '@radix-ui/react-dialog'
import { Cross2Icon } from '@radix-ui/react-icons'
import type { NodeProps as ReactFlowNodeProps } from '@xyflow/react'
import cx from 'classnames'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { analytics } from '../../utils/analytics'
import { debugUI } from '../../utils/debug'
import type { Field, IField } from '../fields'
import s from '../noodles.module.css'
import type { BrushableHistogramOp, IOperator, Operator } from '../operators'
import { getOp } from '../store'
import type { NodeDataJSON } from '../transform-graph'
import { usePropertyHistory } from '../utils/property-history'
import { FieldComponent } from './field-components'
import styles from './brushable-histogram.module.css'
import {
  NodeHeader,
  OutputHandle,
  PAR_HANDLE_OPTIONS,
  useFieldVisibility,
  useLocked,
  useNodeDimmed,
} from './op-components'

interface HistogramDialogProps {
  op: Operator<BrushableHistogramOp>
  open: boolean
  onOpenChange: (open: boolean) => void
}

function BrushableHistogramDialog({ op, open, onOpenChange }: HistogramDialogProps) {
  debugUI('BrushableHistogramDialog render open=%s op=%s', open, op.id)

  const svgRef = useRef<SVGSVGElement>(null)
  const [isDragging, setIsDragging] = useState<'min' | 'max' | null>(null)
  const { captureStart, commitChange } = usePropertyHistory()

  // Get current operator values
  const binData = (op.outputs.binData.value as Array<{ x0: number; x1: number; count: number }>) ?? []
  const extent = (op.outputs.extent.value as [number, number]) ?? [0, 100]
  const brushMin = op.inputs.brushMin.value as number
  const brushMax = op.inputs.brushMax.value as number
  const brushMode = op.inputs.brushMode.value as 'handles' | 'offset'

  // Derived state for offset mode
  const brushCenter = (brushMin + brushMax) / 2
  const brushWidth = brushMax - brushMin

  // Histogram dimensions
  const width = 700
  const height = 300
  const margin = { top: 20, right: 20, bottom: 40, left: 50 }
  const chartWidth = width - margin.left - margin.right
  const chartHeight = height - margin.top - margin.bottom

  // Scales
  const d3 = (globalThis as unknown as Record<string, unknown>).d3 as typeof import('d3')
  const xScale = useMemo(
    () => d3.scaleLinear().domain(extent).range([0, chartWidth]),
    [extent, chartWidth]
  )
  const yScale = useMemo(() => {
    const maxCount = d3.max(binData, d => d.count) ?? 0
    return d3.scaleLinear().domain([0, maxCount]).range([chartHeight, 0])
  }, [binData, chartHeight])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        captureStart()
        analytics.track('brushable_histogram_opened')
      } else {
        commitChange('Adjust histogram brush')
      }
      onOpenChange(nextOpen)
    },
    [captureStart, commitChange, onOpenChange]
  )

  // Handle mouse down on brush handles (handles mode)
  const handleMouseDown = useCallback(
    (handle: 'min' | 'max', e: React.MouseEvent) => {
      e.preventDefault()
      setIsDragging(handle)
      captureStart()

      const onMouseMove = (e: MouseEvent) => {
        if (!svgRef.current) return
        const rect = svgRef.current.getBoundingClientRect()
        const x = e.clientX - rect.left - margin.left
        const value = xScale.invert(x)
        const clamped = Math.max(extent[0], Math.min(extent[1], value))

        if (handle === 'min') {
          op.inputs.brushMin.setValue(Math.min(clamped, brushMax))
        } else {
          op.inputs.brushMax.setValue(Math.max(clamped, brushMin))
        }
      }

      const onMouseUp = () => {
        setIsDragging(null)
        commitChange('Adjust brush handle')
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [svgRef, xScale, extent, brushMin, brushMax, margin.left, captureStart, commitChange, op]
  )

  // Handle offset mode controls
  const handleCenterChange = useCallback(
    (newCenter: number) => {
      const halfWidth = brushWidth / 2
      const minVal = Math.max(extent[0], newCenter - halfWidth)
      const maxVal = Math.min(extent[1], newCenter + halfWidth)
      op.inputs.brushMin.setValue(minVal)
      op.inputs.brushMax.setValue(maxVal)
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
                  <label className={styles.label}>Mode</label>
                  <select
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
                      <label className={styles.label}>Center</label>
                      <input
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
                      <label className={styles.label}>Width</label>
                      <input
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
                      <label className={styles.label}>Min</label>
                      <input
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
                      <label className={styles.label}>Max</label>
                      <input
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
                <svg ref={svgRef} width={width} height={height} className={styles.svg}>
                  <g transform={`translate(${margin.left},${margin.top})`}>
                    {/* Histogram bars */}
                    {binData.map((bin, i) => {
                      const x = xScale(bin.x0 ?? 0)
                      const barWidth = xScale(bin.x1 ?? 0) - x
                      const y = yScale(bin.count)
                      const barHeight = chartHeight - y

                      return (
                        <rect
                          key={i}
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
                      height={chartHeight}
                      className={styles.brushOverlay}
                    />

                    {/* Brush handles */}
                    <g
                      className={cx(styles.brushHandle, isDragging === 'min' && styles.dragging)}
                      onMouseDown={e => handleMouseDown('min', e)}
                    >
                      <line
                        x1={xScale(brushMin)}
                        y1={0}
                        x2={xScale(brushMin)}
                        y2={chartHeight}
                        className={styles.handleLine}
                      />
                      <circle
                        cx={xScale(brushMin)}
                        cy={chartHeight / 2}
                        r={6}
                        className={styles.handleCircle}
                      />
                    </g>

                    <g
                      className={cx(styles.brushHandle, isDragging === 'max' && styles.dragging)}
                      onMouseDown={e => handleMouseDown('max', e)}
                    >
                      <line
                        x1={xScale(brushMax)}
                        y1={0}
                        x2={xScale(brushMax)}
                        y2={chartHeight}
                        className={styles.handleLine}
                      />
                      <circle
                        cx={xScale(brushMax)}
                        cy={chartHeight / 2}
                        r={6}
                        className={styles.handleCircle}
                      />
                    </g>

                    {/* X axis */}
                    <g transform={`translate(0,${chartHeight})`}>
                      <line x1={0} y1={0} x2={chartWidth} y2={0} className={styles.axis} />
                      <text x={0} y={20} className={styles.axisLabel}>
                        {extent[0].toFixed(1)}
                      </text>
                      <text x={chartWidth} y={20} textAnchor="end" className={styles.axisLabel}>
                        {extent[1].toFixed(1)}
                      </text>
                    </g>

                    {/* Y axis */}
                    <g>
                      <line x1={0} y1={0} x2={0} y2={chartHeight} className={styles.axis} />
                      <text x={-10} y={0} textAnchor="end" className={styles.axisLabel}>
                        {(d3.max(binData, d => d.count) ?? 0).toFixed(0)}
                      </text>
                    </g>
                  </g>
                </svg>
              </div>

              <div className={styles.info}>
                Filtered: {(op.outputs.filteredData.value as unknown[])?.length ?? 0} /{' '}
                {(op.inputs.data.value as unknown[])?.length ?? 0} items
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
