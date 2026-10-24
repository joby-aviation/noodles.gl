import cx from 'classnames'
import type { ReactNode } from 'react'
import paneStyles from '../../editor/doc-editor.module.css'
import s from './table-cell-keyframe.module.css'

// What a table's cells can be keyframed with: the parameter pane supplies it, reading and
// writing the document's `<node>.rows.<row>.<column>` tracks
export interface CellKeys {
  // The cell has a track
  animated(row: number, column: string): boolean
  // The cell has a keyframe at the playhead
  keyed(row: number, column: string): boolean
  // Set a keyframe at the playhead with the cell's value, or remove the one there
  toggle(row: number, column: string, value: number | string): void
}

// A value a keyframe can hold: a number eases, text holds. Colors and lists cannot yet.
export function keyframeable(value: unknown): value is number | string {
  return (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'string'
}

// Wraps a table cell with a keyframe diamond, shown on hover or while the cell is animated
export function TableCellKeyframe({
  keys,
  rowIndex,
  column,
  value,
  children,
}: {
  keys: CellKeys
  rowIndex: number
  column: string
  value: unknown
  children: ReactNode
}) {
  if (!keyframeable(value)) return children
  const animated = keys.animated(rowIndex, column)
  const keyed = keys.keyed(rowIndex, column)
  return (
    <div className={s.wrapper}>
      {children}
      <span className={cx(s.indicator, animated && s.animated)}>
        <button
          type="button"
          aria-label={keyed ? 'Remove keyframe' : 'Add keyframe'}
          title={keyed ? 'Keyframe at the playhead (click to remove)' : 'Click to set a keyframe'}
          className={cx(paneStyles.diamond, {
            [paneStyles.diamondTrack]: animated,
            [paneStyles.diamondOn]: keyed,
          })}
          onClick={e => {
            e.stopPropagation()
            keys.toggle(rowIndex, column, value)
          }}
        />
      </span>
    </div>
  )
}
