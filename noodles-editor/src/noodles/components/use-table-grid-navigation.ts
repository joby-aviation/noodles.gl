import {
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { InitialNumberDrag } from './draggable-number-input'

export type EditAdvance = 'next-row' | 'next-column' | 'previous-column'

export interface ActiveEdit {
  set: (commit: () => void) => void
  clear: () => void
  flush: () => void
}

export interface TableCellCoordinate {
  row: number
  column: number
}

export interface TableCellSelection {
  anchor: TableCellCoordinate
  focus: TableCellCoordinate
}

export interface TableSelectionRect {
  firstRow: number
  lastRow: number
  firstColumn: number
  lastColumn: number
}

export function getSelectionRect(selection: TableCellSelection | null): TableSelectionRect | null {
  if (!selection) return null
  return {
    firstRow: Math.min(selection.anchor.row, selection.focus.row),
    lastRow: Math.max(selection.anchor.row, selection.focus.row),
    firstColumn: Math.min(selection.anchor.column, selection.focus.column),
    lastColumn: Math.max(selection.anchor.column, selection.focus.column),
  }
}

export function coordinateInRect(
  coordinate: TableCellCoordinate,
  rect: TableSelectionRect | null
): boolean {
  return Boolean(
    rect &&
      coordinate.row >= rect.firstRow &&
      coordinate.row <= rect.lastRow &&
      coordinate.column >= rect.firstColumn &&
      coordinate.column <= rect.lastColumn
  )
}

export function coordinatesEqual(
  left: TableCellCoordinate | null | undefined,
  right: TableCellCoordinate | null | undefined
): boolean {
  return left?.row === right?.row && left?.column === right?.column
}

export function useActiveEdit(): ActiveEdit {
  const commitRef = useRef<(() => void) | null>(null)

  return useMemo(
    () => ({
      set: (commit: () => void) => {
        commitRef.current = commit
      },
      clear: () => {
        commitRef.current = null
      },
      flush: () => {
        const commit = commitRef.current
        commitRef.current = null
        commit?.()
      },
    }),
    []
  )
}

interface UseTableGridNavigationOptions {
  rowCount: number
  columnCount: number
  tableDataRef: MutableRefObject<unknown[]>
  tableWrapperRef: RefObject<HTMLDivElement | null>
  activeEdit: ActiveEdit
}

export function useTableGridNavigation({
  rowCount,
  columnCount,
  tableDataRef,
  tableWrapperRef,
  activeEdit,
}: UseTableGridNavigationOptions) {
  const [activeCell, setActiveCell] = useState<TableCellCoordinate | null>(() =>
    rowCount > 0 && columnCount > 0 ? { row: 0, column: 0 } : null
  )
  const [selection, setSelection] = useState<TableCellSelection | null>(() =>
    rowCount > 0 && columnCount > 0
      ? { anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } }
      : null
  )
  const [editingCell, setEditingCell] = useState<TableCellCoordinate | null>(null)
  const [editingSeed, setEditingSeed] = useState<string>()
  const [initialNumberDrag, setInitialNumberDrag] = useState<InitialNumberDrag>()
  const pointerSelectingRef = useRef(false)
  const focusActiveCellRef = useRef(false)
  const pendingNumberDragCleanupRef = useRef<(() => void) | null>(null)
  const numberDragTokenRef = useRef(0)

  useEffect(() => {
    const lastRow = rowCount - 1
    const lastColumn = columnCount - 1
    if (lastRow < 0 || lastColumn < 0) {
      setActiveCell(null)
      setSelection(null)
      setEditingCell(null)
      setEditingSeed(undefined)
      setInitialNumberDrag(undefined)
      return
    }

    const clampCoordinate = (coordinate: TableCellCoordinate): TableCellCoordinate => ({
      row: Math.max(0, Math.min(lastRow, coordinate.row)),
      column: Math.max(0, Math.min(lastColumn, coordinate.column)),
    })
    setActiveCell(current => (current ? clampCoordinate(current) : { row: 0, column: 0 }))
    setSelection(current =>
      current
        ? { anchor: clampCoordinate(current.anchor), focus: clampCoordinate(current.focus) }
        : { anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } }
    )
    setEditingCell(current => (current ? clampCoordinate(current) : null))
  }, [columnCount, rowCount])

  useEffect(() => {
    const endPointerSelection = () => {
      pointerSelectingRef.current = false
    }
    document.addEventListener('pointerup', endPointerSelection)
    document.addEventListener('pointercancel', endPointerSelection)
    return () => {
      document.removeEventListener('pointerup', endPointerSelection)
      document.removeEventListener('pointercancel', endPointerSelection)
      pendingNumberDragCleanupRef.current?.()
    }
  }, [])

  const selectCell = useCallback(
    (coordinate: TableCellCoordinate, extend = false) => {
      if (!coordinatesEqual(editingCell, coordinate)) activeEdit.flush()
      setActiveCell(coordinate)
      setSelection(current => ({
        anchor: extend && current ? current.anchor : coordinate,
        focus: coordinate,
      }))
    },
    [activeEdit, editingCell]
  )

  const selectRange = useCallback(
    (anchor: TableCellCoordinate, focus: TableCellCoordinate) => {
      activeEdit.flush()
      focusActiveCellRef.current = true
      setEditingCell(null)
      setEditingSeed(undefined)
      setInitialNumberDrag(undefined)
      setActiveCell(focus)
      setSelection({ anchor, focus })
    },
    [activeEdit]
  )

  const beginEditing = useCallback(
    (coordinate: TableCellCoordinate, seed?: string, numberDrag?: InitialNumberDrag) => {
      activeEdit.flush()
      setActiveCell(coordinate)
      setSelection({ anchor: coordinate, focus: coordinate })
      setEditingSeed(seed)
      setInitialNumberDrag(numberDrag)
      setEditingCell(coordinate)
    },
    [activeEdit]
  )

  const startNumberDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>, coordinate: TableCellCoordinate) => {
      if (event.button !== 0 || event.shiftKey) return false

      pendingNumberDragCleanupRef.current?.()
      pointerSelectingRef.current = false
      selectCell(coordinate)

      const { clientX: startX, clientY: startY, pointerId } = event
      let cleanup: () => void
      const finishPendingDrag = () => cleanup()
      const handlePointerMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return
        const distance = Math.abs(moveEvent.clientX - startX) + Math.abs(moveEvent.clientY - startY)
        if (distance <= 5) return

        cleanup()
        numberDragTokenRef.current += 1
        beginEditing(coordinate, undefined, {
          token: numberDragTokenRef.current,
          startX,
          startY,
          currentX: moveEvent.clientX,
          currentY: moveEvent.clientY,
        })
      }

      cleanup = () => {
        document.removeEventListener('pointermove', handlePointerMove)
        document.removeEventListener('pointerup', finishPendingDrag)
        document.removeEventListener('pointercancel', finishPendingDrag)
        if (pendingNumberDragCleanupRef.current === cleanup) {
          pendingNumberDragCleanupRef.current = null
        }
      }
      document.addEventListener('pointermove', handlePointerMove)
      document.addEventListener('pointerup', finishPendingDrag)
      document.addEventListener('pointercancel', finishPendingDrag)
      pendingNumberDragCleanupRef.current = cleanup
      return true
    },
    [beginEditing, selectCell]
  )

  const finishEditing = useCallback(
    (coordinate: TableCellCoordinate, advance?: EditAdvance) => {
      setEditingCell(null)
      setEditingSeed(undefined)
      setInitialNumberDrag(undefined)
      if (!advance) return

      focusActiveCellRef.current = true
      const currentRowCount = tableDataRef.current.length
      let next = coordinate
      if (advance === 'next-row') {
        next = {
          row: Math.min(currentRowCount - 1, coordinate.row + 1),
          column: coordinate.column,
        }
      } else {
        const linearIndex = coordinate.row * columnCount + coordinate.column
        const offset = advance === 'next-column' ? 1 : -1
        const nextIndex = Math.max(
          0,
          Math.min(currentRowCount * columnCount - 1, linearIndex + offset)
        )
        next = { row: Math.floor(nextIndex / columnCount), column: nextIndex % columnCount }
      }
      setActiveCell(next)
      setSelection({ anchor: next, focus: next })
    },
    [columnCount, tableDataRef]
  )

  const cancelEditing = useCallback((coordinate: TableCellCoordinate) => {
    focusActiveCellRef.current = true
    setEditingCell(null)
    setEditingSeed(undefined)
    setInitialNumberDrag(undefined)
    setActiveCell(coordinate)
    setSelection({ anchor: coordinate, focus: coordinate })
  }, [])

  const moveActiveCell = useCallback(
    (rowOffset: number, columnOffset: number, extend: boolean) => {
      if (tableDataRef.current.length === 0 || columnCount === 0) return
      activeEdit.flush()
      focusActiveCellRef.current = true
      setEditingCell(null)
      setEditingSeed(undefined)
      const current = activeCell ?? { row: 0, column: 0 }
      const next = {
        row: Math.max(0, Math.min(tableDataRef.current.length - 1, current.row + rowOffset)),
        column: Math.max(0, Math.min(columnCount - 1, current.column + columnOffset)),
      }
      setActiveCell(next)
      setSelection(previous => ({
        anchor: extend && previous ? previous.anchor : next,
        focus: next,
      }))
    },
    [activeCell, activeEdit, columnCount, tableDataRef]
  )

  useEffect(() => {
    if (!activeCell || editingCell || !focusActiveCellRef.current) return
    focusActiveCellRef.current = false
    tableWrapperRef.current
      ?.querySelector<HTMLElement>(
        `[data-grid-row="${activeCell.row}"][data-grid-column="${activeCell.column}"]`
      )
      ?.focus({ preventScroll: true })
  }, [activeCell, editingCell, tableWrapperRef])

  const beginPointerSelection = useCallback(
    (coordinate: TableCellCoordinate, extend: boolean) => {
      pointerSelectingRef.current = true
      selectCell(coordinate, extend)
    },
    [selectCell]
  )

  const extendPointerSelection = useCallback((coordinate: TableCellCoordinate) => {
    if (!pointerSelectingRef.current) return
    setActiveCell(coordinate)
    setSelection(current => ({
      anchor: current?.anchor ?? coordinate,
      focus: coordinate,
    }))
  }, [])

  return {
    activeCell,
    selection,
    editingCell,
    editingSeed,
    initialNumberDrag,
    selectCell,
    selectRange,
    beginEditing,
    startNumberDrag,
    finishEditing,
    cancelEditing,
    moveActiveCell,
    beginPointerSelection,
    extendPointerSelection,
  }
}
