// Tests for per-cell keyframe tracks on table data

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DataField } from '../../noodles/fields'
import type { IOperator, Operator } from '../../noodles/operators'
import { getDisplayName } from '../components/KeyframeTrack'
import { bindOperatorToTimeline } from '../field-bindings'
import {
  bindTableCellsToTimeline,
  cellValueToKeyframeValue,
  keyframeValueToCellValue,
  parseTableCellTrackPath,
} from '../table-cell-bindings'
import { getTimelineStore, useTimelineStore } from '../timeline-store'

function makeTableOp(id: string, data: unknown[]) {
  const field = new DataField()
  field.setValue(data)
  const op = {
    id,
    locked: { value: false },
    inputs: { data: field },
  } as unknown as Operator<IOperator>
  return { op, field }
}

function addTrack(path: string, keyframes: Array<[number, unknown]>) {
  const store = getTimelineStore()
  store.getOrCreateTrack(path, keyframes[0][1] as number)
  for (const [position, value] of keyframes) {
    store.addKeyframe(path, { position, value: value as number, interpolation: 'linear' })
  }
}

const rows = () => [
  { city: 'NYC', population: 100, color: '#000000', position: [0, 0] },
  { city: 'SF', population: 50, color: '#ffffff', position: [10, 10] },
]

describe('cellValueToKeyframeValue / keyframeValueToCellValue', () => {
  it('round-trips primitives', () => {
    for (const value of [42, true, 'hello', '2024-01-01']) {
      const kf = cellValueToKeyframeValue(value)
      expect(kf).toEqual(value)
      expect(keyframeValueToCellValue(kf as never, value)).toEqual(value)
    }
  })

  it('converts hex colors to RGBA and keeps the original hex length', () => {
    expect(cellValueToKeyframeValue('#ff0000')).toEqual({ r: 1, g: 0, b: 0, a: 1 })
    expect(keyframeValueToCellValue({ r: 1, g: 0, b: 0, a: 1 }, '#000000')).toBe('#ff0000')
    expect(keyframeValueToCellValue({ r: 1, g: 0, b: 0, a: 1 }, '#000000ff')).toBe('#ff0000ff')
    expect(keyframeValueToCellValue({ r: 1, g: 0, b: 0, a: 0 }, '#000000')).toBe('#ff000000')
  })

  it('does not treat hex-looking strings without # as colors', () => {
    expect(cellValueToKeyframeValue('cafe')).toBe('cafe')
  })

  it('converts numeric tuples to vector objects and back to arrays', () => {
    expect(cellValueToKeyframeValue([1, 2])).toEqual({ x: 1, y: 2 })
    expect(cellValueToKeyframeValue([1, 2, 3])).toEqual({ x: 1, y: 2, z: 3 })
    expect(keyframeValueToCellValue({ x: 5, y: 6 }, [0, 0])).toEqual([5, 6])
    const rgba = cellValueToKeyframeValue([255, 0, 0, 255])
    expect(rgba).toEqual({ 0: 255, 1: 0, 2: 0, 3: 255 })
    expect(keyframeValueToCellValue(rgba as never, [0, 0, 0, 0])).toEqual([255, 0, 0, 255])
    // Raw arrays keyframed by the AI tools interpolate as index-keyed objects
    expect(keyframeValueToCellValue({ 0: 1, 1: 2 }, [0, 0])).toEqual([1, 2])
  })

  it('passes plain objects through', () => {
    const dateTime = { datetime: '2024-01-01T00:00:00.000', timezone: 'UTC' }
    expect(cellValueToKeyframeValue(dateTime)).toEqual(dateTime)
  })

  it('rejects values that cannot be keyframed', () => {
    expect(cellValueToKeyframeValue(null)).toBeUndefined()
    expect(cellValueToKeyframeValue(undefined)).toBeUndefined()
    expect(cellValueToKeyframeValue(Number.NaN)).toBeUndefined()
    expect(cellValueToKeyframeValue([1, 'a'])).toBeUndefined()
  })
})

describe('parseTableCellTrackPath', () => {
  it('parses row index and column', () => {
    expect(parseTableCellTrackPath('table / data / 3 / population', 'table / data / ')).toEqual({
      row: 3,
      column: 'population',
    })
  })

  it('keeps dotted and spaced column names intact', () => {
    expect(
      parseTableCellTrackPath('table / data / 0 / properties.name', 'table / data / ')
    ).toEqual({ row: 0, column: 'properties.name' })
  })

  it('rejects other tracks', () => {
    expect(parseTableCellTrackPath('table / data / x / population', 'table / data / ')).toBeNull()
    expect(parseTableCellTrackPath('table / data / 0', 'table / data / ')).toBeNull()
    expect(parseTableCellTrackPath('other / data / 0 / a', 'table / data / ')).toBeNull()
  })
})

describe('bindTableCellsToTimeline', () => {
  beforeEach(() => {
    useTimelineStore.getState().reset()
  })

  afterEach(() => {
    useTimelineStore.getState().reset()
  })

  it('leaves data untouched when no cells are animated', () => {
    const data = rows()
    const { op, field } = makeTableOp('/table', data)
    const cleanup = bindTableCellsToTimeline(op, 'table / data', field)

    getTimelineStore().setPosition(5)
    expect(field.value).toBe(data)

    cleanup()
  })

  it('applies an interpolated number to one cell while scrubbing', () => {
    const { op, field } = makeTableOp('/table', rows())
    addTrack('table / data / 1 / population', [
      [0, 0],
      [10, 100],
    ])
    const cleanup = bindTableCellsToTimeline(op, 'table / data', field)

    getTimelineStore().setPosition(5)
    const value = field.value as Array<Record<string, unknown>>
    expect(value).toHaveLength(2)
    expect(value[1].population).toBeCloseTo(50, 0)
    expect(value[1].city).toBe('SF')
    expect(value[0]).toEqual(rows()[0])

    cleanup()
  })

  it('animates colors and tuples in their stored formats', () => {
    const { op, field } = makeTableOp('/table', rows())
    addTrack('table / data / 0 / color', [
      [0, { r: 0, g: 0, b: 0, a: 1 }],
      [10, { r: 1, g: 1, b: 1, a: 1 }],
    ])
    addTrack('table / data / 0 / position', [
      [0, { x: 0, y: 0 }],
      [10, { x: 10, y: 20 }],
    ])
    const cleanup = bindTableCellsToTimeline(op, 'table / data', field)

    getTimelineStore().setPosition(10)
    const value = field.value as Array<Record<string, unknown>>
    expect(value[0].color).toBe('#ffffff')
    expect(value[0].position).toEqual([10, 20])

    cleanup()
  })

  it('picks up tracks created after binding', () => {
    const { op, field } = makeTableOp('/table', rows())
    const cleanup = bindTableCellsToTimeline(op, 'table / data', field)

    getTimelineStore().setPosition(10)
    addTrack('table / data / 0 / population', [
      [0, 0],
      [10, 200],
    ])

    expect((field.value as Array<Record<string, unknown>>)[0].population).toBe(200)

    cleanup()
  })

  it('updates the keyframe at the playhead when an animated cell is edited', () => {
    const { op, field } = makeTableOp('/table', rows())
    const path = 'table / data / 0 / population'
    addTrack(path, [
      [0, 0],
      [10, 100],
    ])
    const cleanup = bindTableCellsToTimeline(op, 'table / data', field)
    getTimelineStore().setPosition(10)

    const edited = [...(field.value as Array<Record<string, unknown>>)]
    edited[0] = { ...edited[0], population: 500 }
    field.setValue(edited)

    const track = getTimelineStore().getTrack(path)
    expect(track?.keyframes).toHaveLength(2)
    expect(track?.keyframes[1].value).toBe(500)

    cleanup()
  })

  it('adds a keyframe when an animated cell is edited between keyframes', () => {
    const { op, field } = makeTableOp('/table', rows())
    const path = 'table / data / 0 / population'
    addTrack(path, [
      [0, 0],
      [10, 100],
    ])
    const cleanup = bindTableCellsToTimeline(op, 'table / data', field)
    getTimelineStore().setPosition(5)

    const edited = [...(field.value as Array<Record<string, unknown>>)]
    edited[0] = { ...edited[0], population: 999 }
    field.setValue(edited)

    const track = getTimelineStore().getTrack(path)
    expect(track?.keyframes.map(kf => [kf.position, kf.value])).toEqual([
      [0, 0],
      [5, 999],
      [10, 100],
    ])

    cleanup()
  })

  it('does not keyframe edits to cells that are not animated', () => {
    const { op, field } = makeTableOp('/table', rows())
    const path = 'table / data / 0 / population'
    addTrack(path, [
      [0, 0],
      [10, 100],
    ])
    const cleanup = bindTableCellsToTimeline(op, 'table / data', field)
    getTimelineStore().setPosition(5)

    const edited = [...(field.value as Array<Record<string, unknown>>)]
    edited[1] = { ...edited[1], population: 1 }
    field.setValue(edited)

    expect(getTimelineStore().getTrack(path)?.keyframes).toHaveLength(2)
    expect(getTimelineStore().getTrack('table / data / 1 / population')).toBeUndefined()

    cleanup()
  })

  it('does not record row insertions or deletions as keyframes', () => {
    const { op, field } = makeTableOp('/table', [...rows(), { city: 'LA', population: 7 }])
    const path = 'table / data / 1 / population'
    addTrack(path, [
      [0, 50],
      [10, 60],
    ])
    const cleanup = bindTableCellsToTimeline(op, 'table / data', field)
    getTimelineStore().setPosition(5)

    // Delete row 0: row 1's track now points at LA
    field.setValue((field.value as unknown[]).slice(1))
    expect(getTimelineStore().getTrack(path)?.keyframes).toHaveLength(2)

    cleanup()
  })

  it('skips rows and cells that no longer exist', () => {
    const { op, field } = makeTableOp('/table', rows())
    addTrack('table / data / 5 / population', [
      [0, 0],
      [10, 100],
    ])
    const cleanup = bindTableCellsToTimeline(op, 'table / data', field)

    getTimelineStore().setPosition(5)
    expect(field.value).toHaveLength(2)

    cleanup()
  })

  it('does not apply tracks to a locked operator', () => {
    const data = rows()
    const { op, field } = makeTableOp('/table', data)
    ;(op as unknown as { locked: { value: boolean } }).locked.value = true
    addTrack('table / data / 0 / population', [
      [0, 0],
      [10, 100],
    ])
    const cleanup = bindTableCellsToTimeline(op, 'table / data', field)

    getTimelineStore().setPosition(5)
    expect(field.value).toBe(data)

    cleanup()
  })

  it('stops applying tracks after cleanup', () => {
    const { op, field } = makeTableOp('/table', rows())
    addTrack('table / data / 0 / population', [
      [0, 0],
      [10, 100],
    ])
    const cleanup = bindTableCellsToTimeline(op, 'table / data', field)
    cleanup()

    getTimelineStore().setPosition(10)
    expect((field.value as Array<Record<string, unknown>>)[0].population).toBe(0)
  })
})

describe('bindOperatorToTimeline - table data', () => {
  beforeEach(() => {
    useTimelineStore.getState().reset()
  })

  afterEach(() => {
    useTimelineStore.getState().reset()
  })

  it('binds cell tracks for DataField inputs', () => {
    const { op, field } = makeTableOp('/table', rows())
    addTrack('table / data / 0 / population', [
      [0, 0],
      [10, 100],
    ])
    const cleanup = bindOperatorToTimeline(op)

    getTimelineStore().setPosition(10)
    expect((field.value as Array<Record<string, unknown>>)[0].population).toBe(100)

    cleanup()
  })
})

describe('table cell track serialization', () => {
  beforeEach(() => {
    useTimelineStore.getState().reset()
  })

  afterEach(() => {
    useTimelineStore.getState().reset()
  })

  it('round-trips cell tracks, including dotted column names', () => {
    addTrack('table / data / 0 / population', [
      [0, 0],
      [10, 100],
    ])
    addTrack('table / data / 2 / properties.name', [[0, 'a']])

    const json = getTimelineStore().toTimelineJSON()
    useTimelineStore.getState().reset()
    useTimelineStore.getState().fromTimelineJSON(json)

    const ids = [...getTimelineStore().tracks.keys()].sort()
    expect(ids).toEqual(['table / data / 0 / population', 'table / data / 2 / properties.name'])
  })

  it('keeps the dotted prop path format for other tracks', () => {
    addTrack('my-op / viewState / zoom', [[0, 1]])
    const json = getTimelineStore().toTimelineJSON()
    const props = json.sheetsById.Noodles.sequence.tracksByObject['my-op'].trackIdByPropPath
    expect(Object.keys(props)).toEqual(['viewState.zoom'])
  })
})

describe('table cell track labels', () => {
  it('shows the column and 1-based row number', () => {
    expect(getDisplayName('cities / data / 0 / population')).toBe('population (row 1)')
  })

  it('leaves other track labels alone', () => {
    expect(getDisplayName('basemap / viewState / zoom')).toBe('zoom')
    expect(getDisplayName('container / layer / position / x')).toBe('x')
  })
})
