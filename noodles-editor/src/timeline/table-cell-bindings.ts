// Per-cell keyframe tracks for table data (TableEditorOp's `data` input).
//
// A cell track lives at "<op> / <field> / <rowIndex> / <column>" and is applied over the
// stored rows: scrubbing writes the evaluated value into that one cell, and editing a cell
// that already has keyframes adds or updates a keyframe, matching how other fields behave.
// The stored data shape (an array of row objects) never changes, so no migration is needed.
//
// Rows are addressed by index because tables have no stable row key yet. Inserting or
// deleting rows above an animated row shifts which row its tracks drive.

import type { DataField } from '../noodles/fields'
import type { IOperator, Operator } from '../noodles/operators'
import { deepEqual } from '../noodles/utils/deep-equal'
import { type RGBA as ColorRGBA, hexToRgba, rgbaToHex } from '../utils/color'
import { debugBinding, debugKeyframe, debugTimeline } from '../utils/debug'
import type { TimelineStore } from './timeline-store'
import { getTimelineStore, useTimelineStore } from './timeline-store'
import type { KeyframeValue, RGBA } from './types'

const HEX_COLOR = /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/
const VECTOR_KEYS = ['x', 'y', 'z'] as const

type Row = Record<string, unknown>

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRgba(value: unknown): value is RGBA {
  return isRow(value) && 'r' in value && 'g' in value && 'b' in value && 'a' in value
}

// Convert a cell value to a value the timeline can store and interpolate.
// Returns undefined for values that can't be keyframed (null, functions, mixed arrays).
export function cellValueToKeyframeValue(value: unknown): KeyframeValue | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return HEX_COLOR.test(value) ? hexToRgba(value) : value

  // Numeric tuples (point2d, vec3, ...) become {x, y, z} so they interpolate per channel.
  // Other lengths use index keys, which interpolate as a generic compound value.
  if (Array.isArray(value)) {
    if (value.length === 0 || !value.every(v => typeof v === 'number' && Number.isFinite(v))) {
      return undefined
    }
    const keys = value.length <= 3 && value.length >= 2 ? VECTOR_KEYS : value.map((_, i) => `${i}`)
    return Object.fromEntries(value.map((v, i) => [keys[i], v])) as KeyframeValue
  }

  // Plain objects ({lng, lat}, {datetime, timezone}) pass through
  if (isRow(value)) return value as KeyframeValue

  return undefined
}

// Convert an evaluated keyframe value back to a cell value, shaped like the cell's current value
export function keyframeValueToCellValue(kfValue: KeyframeValue, currentValue: unknown): unknown {
  if (isRgba(kfValue)) {
    const hex = rgbaToHex(kfValue as ColorRGBA)
    // Keep "#rrggbb" cells in that format when the color is opaque
    const opaque = hex.endsWith('ff')
    return typeof currentValue === 'string' && currentValue.length === 7 && opaque
      ? hex.slice(0, 7)
      : hex
  }

  // Tuples come back as {x, y, z}, or as index keys when a raw array was keyframed
  // (e.g. by the AI tools) and interpolated as a generic compound value
  if (Array.isArray(currentValue) && isRow(kfValue)) {
    return currentValue.map((v, i) => {
      const channel = kfValue[VECTOR_KEYS[i] ?? `${i}`] ?? kfValue[`${i}`]
      return typeof channel === 'number' ? channel : v
    })
  }

  return kfValue
}

// Parse "<rowIndex> / <column>" from the part of a track path after the field prefix
export function parseTableCellTrackPath(
  trackPath: string,
  fieldPrefix: string
): { row: number; column: string } | null {
  if (!trackPath.startsWith(fieldPrefix)) return null
  const rest = trackPath.slice(fieldPrefix.length)
  const separator = rest.indexOf(' / ')
  if (separator === -1) return null
  const rowPart = rest.slice(0, separator)
  const column = rest.slice(separator + 3)
  if (!/^\d+$/.test(rowPart) || column === '') return null
  return { row: Number(rowPart), column }
}

interface CellTrack {
  trackId: string
  row: number
  column: string
}

// Bind every cell track under `fieldPath` (e.g. "table / data") to a DataField of row objects.
// Cell tracks are discovered from the store, so tracks added later (from the table's keyframe
// buttons, the timeline, or the AI tools) are picked up without rebinding. Returns cleanup.
export function bindTableCellsToTimeline(
  op: Operator<IOperator>,
  fieldPath: string,
  field: DataField,
  store?: TimelineStore
): () => void {
  const timelineStore = store || useTimelineStore.getState()
  const prefix = `${fieldPath} / `

  let updating = false
  let cellTracks: CellTrack[] = []
  // Last keyframe value seen per track, as JSON, so unrelated edits don't add keyframes
  const lastValues = new Map<string, string>()
  let lastRowCount = Array.isArray(field.value) ? field.value.length : 0

  const readCell = (data: unknown, { row, column }: CellTrack) => {
    const rowValue = Array.isArray(data) ? data[row] : undefined
    return isRow(rowValue) ? { found: true, value: rowValue[column] } : { found: false }
  }

  const seed = (data: unknown, track: CellTrack) => {
    const cell = readCell(data, track)
    const kfValue = cell.found ? cellValueToKeyframeValue(cell.value) : undefined
    if (kfValue === undefined) lastValues.delete(track.trackId)
    else lastValues.set(track.trackId, JSON.stringify(kfValue))
  }

  const refreshTracks = (tracks: Map<string, unknown>) => {
    const next: CellTrack[] = []
    for (const trackId of tracks.keys()) {
      const parsed = parseTableCellTrackPath(trackId, prefix)
      if (parsed) next.push({ trackId, ...parsed })
    }
    cellTracks = next
    const ids = new Set(next.map(t => t.trackId))
    for (const id of lastValues.keys()) {
      if (!ids.has(id)) lastValues.delete(id)
    }
  }

  // Write the evaluated value of every cell track into a copy of the rows
  const applyAt = (position: number) => {
    if (op.locked?.value || updating || cellTracks.length === 0) return
    const data = field.value
    if (!Array.isArray(data)) return

    let nextData: unknown[] | null = null
    for (const track of cellTracks) {
      const kfValue = timelineStore.evaluateTrack(track.trackId, position)
      if (kfValue === undefined) continue
      const rows = nextData ?? data
      const rowValue = rows[track.row]
      if (!isRow(rowValue)) continue

      const cellValue = keyframeValueToCellValue(kfValue, rowValue[track.column])
      if (!deepEqual(cellValue, rowValue[track.column])) {
        nextData ??= [...data]
        nextData[track.row] = { ...rowValue, [track.column]: cellValue }
      }
      seed(nextData ?? data, track)
    }

    if (nextData) {
      debugBinding('apply %d cell tracks under %s @ %s', cellTracks.length, fieldPath, position)
      updating = true
      try {
        field.setValue(nextData)
      } catch (e) {
        debugTimeline(`Error applying table cell tracks for ${fieldPath}:`, e)
      }
      updating = false
    }
  }

  refreshTracks(useTimelineStore.getState().tracks)
  for (const track of cellTracks) seed(field.value, track)
  applyAt(getTimelineStore().position)

  const unsubscribePosition = useTimelineStore.subscribe(
    state => state.position,
    position => applyAt(position)
  )

  // New, deleted, or edited tracks (undo/redo, keyframe value popup, AI tools)
  const unsubscribeTracks = useTimelineStore.subscribe(
    state => state.tracks,
    tracks => {
      const known = new Set(cellTracks.map(t => t.trackId))
      refreshTracks(tracks)
      for (const track of cellTracks) {
        if (!known.has(track.trackId)) seed(field.value, track)
      }
      applyAt(getTimelineStore().position)
    }
  )

  // Cell edits -> add or update keyframes on cells that are already animated
  const fieldSub = field.subscribe((data: unknown) => {
    const rowCount = Array.isArray(data) ? data.length : 0
    const structural = rowCount !== lastRowCount
    lastRowCount = rowCount
    if (op.locked?.value || updating || cellTracks.length === 0) return

    // Adding or removing rows moves values between indices; don't record that as animation
    if (structural) {
      for (const track of cellTracks) seed(data, track)
      return
    }

    const { position } = getTimelineStore()
    const epsilon = 0.001
    for (const track of cellTracks) {
      const cell = readCell(data, track)
      const kfValue = cell.found ? cellValueToKeyframeValue(cell.value) : undefined
      if (kfValue === undefined) continue
      const json = JSON.stringify(kfValue)
      if (lastValues.get(track.trackId) === json) continue
      lastValues.set(track.trackId, json)

      const existing = timelineStore.getTrack(track.trackId)
      if (!existing || existing.keyframes.length === 0) continue

      updating = true
      try {
        const kfAtPosition = existing.keyframes.find(
          kf => Math.abs(kf.position - position) < epsilon
        )
        if (kfAtPosition) {
          debugKeyframe('update cell kf %s @ %s → %O', track.trackId, position, kfValue)
          timelineStore.updateKeyframe(track.trackId, kfAtPosition.id, { value: kfValue })
        } else {
          debugKeyframe('add cell kf %s @ %s value=%O', track.trackId, position, kfValue)
          timelineStore.addKeyframe(track.trackId, {
            position,
            value: kfValue,
            interpolation: 'bezier',
          })
        }
      } catch (e) {
        debugTimeline(`Error keyframing table cell ${track.trackId}:`, e)
      }
      updating = false
    }
  })

  return () => {
    unsubscribePosition()
    unsubscribeTracks()
    fieldSub.unsubscribe()
  }
}
