// Editors in the parameter pane for nodes whose value is easier drawn than typed: a basemap
// style, a ramp's stops, a table's rows, a histogram's brush. Each reads and writes the node's
// own parameters, so undo, save and the engine see a plain parameter change; the parameters it
// replaces are left out of the pane's list. Features and points are edited on the map itself
// (EditOnMapButton).

import { type DocNode, OPERATOR_INDEX, type ParamValue } from '@noodles.gl/planner'
import { type ComponentType, useEffect, useRef, useState } from 'react'
import { MapStyleConfiguratorDialog } from '../noodles/components/map-style-configurator'
import RampEditor, { type RampStop } from '../noodles/components/ramp-editor'
import { type CellKeys, keyframeable } from '../noodles/components/table-cell-keyframe'
import { TableEditor } from '../noodles/components/table-editor'
import { inferSchema, type TableSchema } from '../noodles/table-schema'
import { DEFAULT_STOPS } from '../runtime/value-ops'
import type { RampInterpType } from '../utils/curves'
import type { StyleConfiguratorData } from '../utils/map-style-utils'
import s from './doc-editor.module.css'
import { useEngineState } from './doc-engine'
import { removeKey, setKey, setParam } from './doc-ops'
import { docStore, useEditor } from './doc-store'
import { HistogramEditor } from './histogram-editor'

interface PaneEditor {
  Editor: ComponentType<{ node: DocNode }>
  /** Parameters the editor stands in for, hidden from the pane's list. */
  replaces: string[]
}

// Set one of the node's parameters; a tag makes a drag one undo step
function set(node: DocNode, param: string, value: ParamValue, tag?: string) {
  docStore().edit(d => setParam(d, node.id, param, value), tag)
}

// A parameter's value, or its operator's default when the document leaves it out
function param(node: DocNode, name: string): unknown {
  return (
    node.params[name] ?? OPERATOR_INDEX.get(node.op)?.params.find(p => p.name === name)?.default
  )
}

function parse<T>(text: unknown, fallback: T): T {
  if (typeof text !== 'string' || !text.trim()) return fallback
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

function MapStyleEditor({ node }: { node: DocNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className={s.paneButton} onClick={() => setOpen(true)}>
        Edit style
      </button>
      <MapStyleConfiguratorDialog
        open={open}
        onOpenChange={setOpen}
        baseStyle={param(node, 'baseStyle') as string | undefined}
        overrides={param(node, 'overrides') as StyleConfiguratorData | undefined}
        onOverridesChange={next => set(node, 'overrides', next as never, `style:${node.id}`)}
      />
    </>
  )
}

// The ramp editor tells stops apart by id; the document keeps only pos, val and interp
export function rampStops(node: DocNode): RampStop[] {
  const stops = parse<Omit<RampStop, 'id'>[]>(param(node, 'stops'), [])
  const list = Array.isArray(stops) && stops.length ? stops : DEFAULT_STOPS
  return list.map((st, i) => ({ ...st, id: String(i) }))
}

export const stopsText = (stops: RampStop[]) =>
  JSON.stringify([...stops].sort((a, b) => a.pos - b.pos).map(({ id: _, ...st }) => st))

// The width of an element, followed as the pane is resized
function useWidth(fallback: number) {
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

function RampStopsEditor({ node }: { node: DocNode }) {
  const [ref, width] = useWidth(220)
  const stops = rampStops(node)
  const [active, setActive] = useState<string | null>(null)
  const activeStop = stops.find(st => st.id === active)
  const write = (next: RampStop[], tag?: string) => set(node, 'stops', stopsText(next), tag)
  return (
    <div ref={ref}>
      <RampEditor
        stops={stops}
        width={Math.max(120, width)}
        onChange={next => write(next, `ramp:${node.id}`)}
        onStructuralChange={next => write(next)}
        activeStopId={active}
        onActivate={setActive}
      />
      {activeStop && (
        <div className={s.paneRow}>
          <select
            aria-label="Interpolation"
            value={activeStop.interp ?? 'smooth'}
            onChange={e =>
              write(
                stops.map(st =>
                  st.id === active ? { ...st, interp: e.target.value as RampInterpType } : st
                )
              )
            }
          >
            <option value="linear">Linear</option>
            <option value="smooth">Smooth</option>
            <option value="hold">Hold</option>
          </select>
          {stops.length > 2 && (
            <button
              type="button"
              className={s.paneButton}
              onClick={() => {
                write(stops.filter(st => st.id !== active))
                setActive(null)
              }}
            >
              Delete stop
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// A cell's track: `<node>.rows.<row>.<column>`
export const cellTarget = (nodeId: string, row: number, column: string) =>
  `${nodeId}.rows.${row}.${column}`

function RowsEditor({ node }: { node: DocNode }) {
  const rows = parse<unknown[]>(param(node, 'rows'), [])
  const typed = Array.isArray(rows) ? rows : []
  const schema = parse<TableSchema | null>(param(node, 'schema'), null) ?? inferSchema(typed)
  const writeRows = (next: unknown[]) => JSON.stringify(next, null, 2)
  const tracks = useEditor(st => st.doc.timeline?.tracks)
  const time = useEditor(st => st.time)
  const slots = useEngineState().slots

  const trackOf = (row: number, column: string) =>
    tracks?.find(t => t.target === cellTarget(node.id, row, column))
  // An animated cell shows its value at the playhead
  const data = typed.map((r, i) => {
    if (!r || typeof r !== 'object') return r
    const shown = { ...(r as Record<string, unknown>) }
    for (const column of Object.keys(shown)) {
      const v = trackOf(i, column) ? slots.get(cellTarget(node.id, i, column)) : undefined
      if (v !== undefined && keyframeable(v)) shown[column] = v
    }
    return shown
  })

  const cellKeys: CellKeys = {
    animated: (row, column) => !!trackOf(row, column),
    keyed: (row, column) =>
      !!trackOf(row, column)?.keyframes.some(k => Math.abs(k.time - time) < 1e-3),
    toggle: (row, column, value) =>
      docStore().edit(d => {
        const target = cellTarget(node.id, row, column)
        const keyed = d.timeline?.tracks
          .find(t => t.target === target)
          ?.keyframes.some(k => Math.abs(k.time - time) < 1e-3)
        if (keyed) removeKey(d, target, time)
        else setKey(d, target, time, value)
      }),
  }

  // An edit to an animated cell sets a keyframe at the playhead, as editing a keyframed
  // parameter does; the typed rows keep their value
  const onDataChange = (next: unknown[]) =>
    docStore().edit(d => {
      const kept = next.map((r, i) => {
        if (!r || typeof r !== 'object') return r
        const row = { ...(r as Record<string, unknown>) }
        const before = data[i] as Record<string, unknown> | undefined
        for (const column of Object.keys(row)) {
          if (!trackOf(i, column)) continue
          if (before && row[column] !== before[column] && keyframeable(row[column])) {
            setKey(d, cellTarget(node.id, i, column), time, row[column])
          }
          const original = (typed[i] as Record<string, unknown> | undefined)?.[column]
          if (original !== undefined) row[column] = original
        }
        return row
      })
      setParam(d, node.id, 'rows', writeRows(kept))
    })

  return (
    <TableEditor
      data={data}
      schema={schema}
      onDataChange={onDataChange}
      cellKeys={cellKeys}
      onSchemaChange={(next, nextRows) =>
        docStore().edit(d => {
          setParam(d, node.id, 'schema', JSON.stringify(next))
          if (nextRows) setParam(d, node.id, 'rows', writeRows(nextRows))
        })
      }
    />
  )
}

export const PANE_EDITORS: Record<string, PaneEditor> = {
  'map-style': { Editor: MapStyleEditor, replaces: ['overrides'] },
  ramp: { Editor: RampStopsEditor, replaces: ['stops'] },
  table: { Editor: RowsEditor, replaces: ['rows', 'schema'] },
  // Brush min and max stay in the list, where they are keyframed
  'brushable-histogram': { Editor: HistogramEditor, replaces: [] },
}

export function PaneEditorFor({ node }: { node: DocNode }) {
  const entry = PANE_EDITORS[node.op]
  if (!entry) return null
  return (
    <div className={s.paneEditor}>
      <entry.Editor node={node} />
    </div>
  )
}
