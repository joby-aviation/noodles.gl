import type { ReactNode } from 'react'
import { KeyframeIndicator } from '../../timeline/components/KeyframeIndicator'
import { getFieldPath } from '../../timeline/field-bindings'
import { cellValueToKeyframeValue } from '../../timeline/table-cell-bindings'
import { useTimelineStore } from '../../timeline/timeline-store'
import s from './table-cell-keyframe.module.css'

interface TableCellKeyframeProps {
  opId: string
  rowIndex: number
  column: string
  value: unknown
  disabled?: boolean
  children: ReactNode
}

// Wraps a table cell with a keyframe diamond, shown on hover or while the cell is animated.
// Tracks are keyed "<op> / data / <rowIndex> / <column>" and applied by bindTableCellsToTimeline.
export function TableCellKeyframe({
  opId,
  rowIndex,
  column,
  value,
  disabled,
  children,
}: TableCellKeyframeProps) {
  const subPath = [String(rowIndex), column]
  const fieldPath = getFieldPath(opId, 'data', subPath)
  const animated = useTimelineStore(
    state => (state.tracks.get(fieldPath)?.keyframes.length ?? 0) > 0
  )
  const kfValue = cellValueToKeyframeValue(value)

  if (kfValue === undefined) return children

  return (
    <div className={s.wrapper}>
      {children}
      <span className={animated ? `${s.indicator} ${s.animated}` : s.indicator}>
        <KeyframeIndicator
          opId={opId}
          fieldName="data"
          subPath={subPath}
          currentValue={kfValue}
          disabled={disabled}
          size="small"
        />
      </span>
    </div>
  )
}
