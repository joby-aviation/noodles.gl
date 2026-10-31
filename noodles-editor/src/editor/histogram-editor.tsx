// The brushable histogram's pane editor: the column's histogram, read from the node's `bins`
// output, with a brush over it. Dragging the brush writes Brush min and Brush max, so undo,
// keyframes and the engine see plain parameter changes, and a drag only rebinds the filter.

import { type DocNode, histogramSql, OPERATOR_INDEX } from '@noodles.gl/planner'
import cx from 'classnames'
import { max as d3Max, scaleLinear } from 'd3'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import styles from '../noodles/components/brushable-histogram.module.css'
import { analytics } from '../utils/analytics'
import { currentEngine, useEngineState } from './doc-engine'
import { setParam } from './doc-ops'
import { docStore } from './doc-store'

export interface Bin {
  x0: number
  x1: number
  count: number
}

type Handle = 'min' | 'max'

const HEIGHT = 140
const MARGIN = { top: 8, right: 10, bottom: 22, left: 34 }
// Arrow keys move a handle by 1% of the extent; Shift or PageUp/PageDown by 10%
const KEYBOARD_STEPS = 100
const LARGE_STEP = 10

// The histogram of the rows the node reads and how many its brush keeps, read from the engine
// whenever it draws. Only the filters and the column are lowered to SQL, so nothing upstream
// without a SQL form (a color ramp) is in the way.
function useHistogram(node: DocNode) {
  const engine = useEngineState()
  const [bins, setBins] = useState<Bin[]>([])
  const [kept, setKept] = useState<number | undefined>()
  const binsKey = useRef<string>()
  const out = engine.lowered?.outputs[node.id]?.out
  const filter = engine.lowered?.graph.nodes.find(n => n.id === out)
  const input = filter && 'input' in filter ? (filter.input as string) : undefined
  const column = String(node.params.column ?? '')
  const binCount = Math.max(1, Math.min(1000, Math.round(Number(node.params.binCount ?? 20))))
  // biome-ignore lint/correctness/useExhaustiveDependencies: read again whenever the engine draws, as the rows may have changed
  useEffect(() => {
    const e = currentEngine()
    if (!e || !out || !input || !column) return
    let stale = false
    void (async () => {
      try {
        const [from, brushed] = await Promise.all([
          e.runtime.nodeSql(input, [column]),
          e.runtime.nodeSql(out, [column]),
        ])
        const key = from && `${from.hash}:${binCount}`
        if (from && key !== binsKey.current) {
          const rows = await e.runtime.query(histogramSql(column, binCount, `(${from.sql})`))
          if (stale) return
          binsKey.current = key
          setBins(rows.map(r => ({ x0: Number(r.x0), x1: Number(r.x1), count: Number(r.count) })))
        }
        if (brushed) {
          const [row] = await e.runtime.query(`SELECT count(*) AS n FROM (${brushed.sql})`)
          if (!stale) setKept(Number(row?.n ?? 0))
        }
      } catch {
        // A column that is not there yet: the pane shows no histogram
        if (!stale) setBins([])
      }
    })()
    return () => {
      stale = true
    }
  }, [engine, out, input, column, binCount])
  return { bins, kept }
}

// A parameter's value at the playhead, as the engine evaluated it
function useValue(node: DocNode, name: string): number {
  const slots = useEngineState().slots
  const fallback =
    node.params[name] ?? OPERATOR_INDEX.get(node.op)?.params.find(p => p.name === name)?.default
  const v = slots.get(`${node.id}.${name}`) ?? fallback
  return Number.isFinite(Number(v)) ? Number(v) : 0
}

// A value to the precision a thousandth of the extent has
export function roundTo(value: number, extent: [number, number]): number {
  const span = Math.abs(extent[1] - extent[0])
  const decimals = span > 0 ? Math.max(0, Math.min(12, 3 - Math.floor(Math.log10(span)))) : 3
  return Number(value.toFixed(decimals))
}

function useMeasuredWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

export function HistogramEditor({ node }: { node: DocNode }) {
  const { bins, kept } = useHistogram(node)
  const [ref, measured] = useMeasuredWidth(260)
  const width = Math.max(160, measured)
  const chartWidth = width - MARGIN.left - MARGIN.right
  const chartHeight = HEIGHT - MARGIN.top - MARGIN.bottom
  const svgRef = useRef<SVGSVGElement>(null)
  const [dragging, setDragging] = useState<Handle | null>(null)
  const ids = useId()

  const brushMin = useValue(node, 'brushMin')
  const brushMax = useValue(node, 'brushMax')
  const mode = String(node.params.brushMode ?? 'handles')
  const extent = useMemo<[number, number]>(
    () => (bins.length ? [bins[0].x0, bins[bins.length - 1].x1] : [0, 1]),
    [bins]
  )
  const total = bins.reduce((n, b) => n + b.count, 0)

  const x = useMemo(
    () => scaleLinear().domain(extent).range([0, chartWidth]).clamp(true),
    [extent, chartWidth]
  )
  const maxCount = d3Max(bins, b => b.count) ?? 0
  const y = useMemo(
    () =>
      scaleLinear()
        .domain([0, maxCount || 1])
        .range([chartHeight, 0]),
    [maxCount, chartHeight]
  )

  useEffect(() => {
    analytics.track('brushable_histogram_opened')
  }, [])

  // One undo step per gesture: every write of a drag carries its tag
  const write = useCallback(
    (values: Partial<Record<'brushMin' | 'brushMax', number>>, tag?: string) => {
      const time = docStore().get().time
      docStore().edit(d => {
        for (const [name, value] of Object.entries(values)) {
          setParam(d, node.id, name, value, time)
        }
      }, tag)
    },
    [node.id]
  )

  // Moves one handle, kept inside the extent and on its side of the other handle, to a
  // thousandth of the extent: a drag writes 4.542, not 4.542061152061152
  const moveHandle = useCallback(
    (handle: Handle, value: number, tag?: string) => {
      const clamped = roundTo(Math.max(extent[0], Math.min(extent[1], value)), extent)
      if (handle === 'min') write({ brushMin: Math.min(clamped, brushMax) }, tag)
      else write({ brushMax: Math.max(clamped, brushMin) }, tag)
    },
    [extent, brushMin, brushMax, write]
  )

  const startDrag = (handle: Handle, e: React.PointerEvent) => {
    e.preventDefault()
    setDragging(handle)
    const tag = `histogram:${node.id}:${Date.now()}`
    const onMove = (move: PointerEvent) => {
      const rect = svgRef.current?.getBoundingClientRect()
      if (!rect) return
      // The SVG may be drawn scaled: screen pixels to its own units
      const px = ((move.clientX - rect.left) * width) / rect.width - MARGIN.left
      moveHandle(handle, x.invert(px), tag)
    }
    const onUp = () => {
      setDragging(null)
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }

  // Keyboard control, as the ARIA slider pattern has it
  const onKey = (handle: Handle, e: React.KeyboardEvent) => {
    const step = (extent[1] - extent[0]) / KEYBOARD_STEPS || 1
    const large = step * LARGE_STEP
    const current = handle === 'min' ? brushMin : brushMax
    const delta = e.shiftKey ? large : step
    const next: Record<string, number> = {
      ArrowLeft: current - delta,
      ArrowDown: current - delta,
      ArrowRight: current + delta,
      ArrowUp: current + delta,
      PageDown: current - large,
      PageUp: current + large,
      Home: extent[0],
      End: extent[1],
    }
    if (!(e.key in next)) return
    e.preventDefault()
    moveHandle(handle, next[e.key], `histogram-key:${node.id}:${handle}`)
  }

  // Center and width: moving the center keeps the width, stopping at the extent's ends
  const center = (brushMin + brushMax) / 2
  const span = brushMax - brushMin
  const setCenter = (value: number) => {
    const half = Math.min(span, extent[1] - extent[0]) / 2
    const c = Math.max(extent[0] + half, Math.min(extent[1] - half, value))
    write(
      { brushMin: roundTo(c - half, extent), brushMax: roundTo(c + half, extent) },
      `histogram-center:${node.id}`
    )
  }
  const setSpan = (value: number) => {
    let lo = center - value / 2
    let hi = center + value / 2
    if (lo < extent[0]) {
      lo = extent[0]
      hi = Math.min(extent[1], lo + value)
    }
    if (hi > extent[1]) {
      hi = extent[1]
      lo = Math.max(extent[0], hi - value)
    }
    write(
      { brushMin: roundTo(lo, extent), brushMax: roundTo(hi, extent) },
      `histogram-width:${node.id}`
    )
  }

  if (bins.length === 0) {
    return (
      <div ref={ref} className={styles.emptyState}>
        Connect rows and pick a numeric column to see its histogram.
      </div>
    )
  }

  const handle = (which: Handle) => {
    const value = which === 'min' ? brushMin : brushMax
    const at = x(value)
    return (
      <g
        role="slider"
        tabIndex={0}
        aria-label={which === 'min' ? 'Brush minimum' : 'Brush maximum'}
        aria-orientation="horizontal"
        aria-valuemin={which === 'min' ? extent[0] : brushMin}
        aria-valuemax={which === 'min' ? brushMax : extent[1]}
        aria-valuenow={value}
        aria-valuetext={value.toFixed(2)}
        className={cx(styles.brushHandle, dragging === which && styles.dragging)}
        onPointerDown={e => startDrag(which, e)}
        onKeyDown={e => onKey(which, e)}
      >
        <line x1={at} y1={0} x2={at} y2={chartHeight} className={styles.handleLine} />
        <circle cx={at} cy={chartHeight / 2} r={5} className={styles.handleCircle} />
      </g>
    )
  }

  const step = (extent[1] - extent[0]) / 1000 || 0.001
  return (
    <div ref={ref}>
      <svg
        ref={svgRef}
        width={width}
        height={HEIGHT}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        className={styles.svg}
      >
        <title>
          {`Histogram of ${String(node.params.column ?? 'values')}, brushed from ${brushMin.toFixed(2)} to ${brushMax.toFixed(2)}`}
        </title>
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          {bins.map(b => (
            <rect
              key={`${b.x0}-${b.x1}`}
              x={x(b.x0)}
              y={y(b.count)}
              width={Math.max(0, x(b.x1) - x(b.x0) - 1)}
              height={chartHeight - y(b.count)}
              className={styles.bar}
            />
          ))}
          <rect
            x={x(brushMin)}
            y={0}
            width={Math.max(0, x(brushMax) - x(brushMin))}
            height={chartHeight}
            className={styles.brushOverlay}
          />
          {handle('min')}
          {handle('max')}
          <g transform={`translate(0,${chartHeight})`}>
            <line x1={0} y1={0} x2={chartWidth} y2={0} className={styles.axis} />
            <text x={0} y={16} className={styles.axisLabel}>
              {extent[0].toFixed(1)}
            </text>
            <text x={chartWidth} y={16} textAnchor="end" className={styles.axisLabel}>
              {extent[1].toFixed(1)}
            </text>
          </g>
          <line x1={0} y1={0} x2={0} y2={chartHeight} className={styles.axis} />
          <text x={-6} y={8} textAnchor="end" className={styles.axisLabel}>
            {maxCount.toFixed(0)}
          </text>
        </g>
      </svg>
      {mode === 'offset' && (
        <>
          <div className={styles.controlRow}>
            <label htmlFor={`${ids}-center`} className={styles.label}>
              Center
            </label>
            <input
              id={`${ids}-center`}
              type="range"
              className={styles.slider}
              min={extent[0]}
              max={extent[1]}
              step={step}
              value={center}
              onChange={e => setCenter(Number.parseFloat(e.target.value))}
            />
            <span className={styles.value}>{center.toFixed(2)}</span>
          </div>
          <div className={styles.controlRow}>
            <label htmlFor={`${ids}-width`} className={styles.label}>
              Width
            </label>
            <input
              id={`${ids}-width`}
              type="range"
              className={styles.slider}
              min={0}
              max={extent[1] - extent[0]}
              step={step}
              value={span}
              onChange={e => setSpan(Number.parseFloat(e.target.value))}
            />
            <span className={styles.value}>{span.toFixed(2)}</span>
          </div>
        </>
      )}
      <div className={styles.info}>
        Kept {kept ?? '…'} of {total} rows with a value
      </div>
    </div>
  )
}
