import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getTimelineStore, useTimelineStore } from '../../timeline/timeline-store'
import { TableEditorOp } from '../operators'
import type { TableSchema } from '../table-schema'
import { TableEditor } from './table-editor'

describe('TableEditor cell keyframes', () => {
  const schema: TableSchema = {
    columns: [
      { name: 'name', type: 'string', defaultValue: '' },
      { name: 'count', type: 'number', defaultValue: 0 },
      { name: 'color', type: 'color', defaultValue: '#000000' },
    ],
  }
  const data = [
    { name: 'Alice', count: 10, color: '#ff0000' },
    { name: 'Bob', count: 20, color: '#00ff00' },
  ]

  beforeEach(() => {
    useTimelineStore.getState().reset()
  })

  afterEach(() => {
    cleanup()
    useTimelineStore.getState().reset()
  })

  const renderTable = () =>
    render(
      <TableEditor
        op={new TableEditorOp('/table')}
        data={data}
        schema={schema}
        onDataChange={vi.fn()}
        onSchemaChange={vi.fn()}
      />
    )

  it('shows a keyframe button for each cell', () => {
    const { getAllByRole } = renderTable()
    expect(getAllByRole('button', { name: 'Add keyframe' })).toHaveLength(6)
  })

  it('adds a keyframe on the cell track without editing the cell', () => {
    const { getAllByRole, queryByRole } = renderTable()
    getTimelineStore().setPosition(2)

    // Row 1, "count" column: second row's buttons come after the first row's three
    fireEvent.click(getAllByRole('button', { name: 'Add keyframe' })[4])

    const track = getTimelineStore().getTrack('table / data / 1 / count')
    expect(track?.keyframes.map(kf => [kf.position, kf.value])).toEqual([[2, 20]])
    expect(queryByRole('spinbutton')).toBeNull()
  })

  it('stores color cells as RGBA keyframes', () => {
    const { getAllByRole } = renderTable()
    fireEvent.click(getAllByRole('button', { name: 'Add keyframe' })[2])

    const track = getTimelineStore().getTrack('table / data / 0 / color')
    expect(track?.keyframes[0].value).toEqual({ r: 1, g: 0, b: 0, a: 1 })
  })
})
