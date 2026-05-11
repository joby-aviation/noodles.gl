import { useCallback, useEffect, useRef, useState } from 'react'
import type { Subscription } from 'rxjs'
import { getOp, useUIStore } from '../../store'
import { SpreadsheetViewer } from './spreadsheet-viewer'
import s from './spreadsheet-pane.module.css'

const MIN_WIDTH = 300
const MAX_WIDTH = 800

export function SpreadsheetPane({ selectedNodeIds }: { selectedNodeIds: string[] }) {
  const visible = useUIStore(state => state.spreadsheetVisible)
  const width = useUIStore(state => state.spreadsheetWidth)
  const setWidth = useUIStore(state => state.setSpreadsheetWidth)
  const pinnedNodeId = useUIStore(state => state.pinnedSpreadsheetNodeId)
  const setPinnedNodeId = useUIStore(state => state.setPinnedSpreadsheetNodeId)

  const [data, setData] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)
  const subscriptionRef = useRef<Subscription | null>(null)

  // Determine which operator to display (pinned or selected)
  const targetNodeId = pinnedNodeId || (selectedNodeIds.length === 1 ? selectedNodeIds[0] : null)

  // Subscribe to operator's first output field
  useEffect(() => {
    if (!visible || !targetNodeId) {
      setData(null)
      setError(null)
      return
    }

    const op = getOp(targetNodeId)
    if (!op) {
      setError('Operator not found')
      // Clear pinned node if it was deleted
      if (pinnedNodeId) {
        setPinnedNodeId(null)
      }
      return
    }

    const outputFields = Object.values(op.outputs)
    if (outputFields.length === 0) {
      setError('No outputs available')
      return
    }

    const firstOutput = outputFields[0]
    subscriptionRef.current = firstOutput.subscribe(value => {
      setData(value)
      setError(null)
    })

    return () => {
      subscriptionRef.current?.unsubscribe()
    }
  }, [visible, targetNodeId, pinnedNodeId, setPinnedNodeId])

  // Resize handling
  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startWidth = width

      function onMouseMove(moveEvent: MouseEvent) {
        const deltaX = startX - moveEvent.clientX
        const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + deltaX))
        setWidth(newWidth)
      }

      function onMouseUp() {
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [width, setWidth]
  )

  // Pin/unpin handler
  const handleTogglePin = useCallback(() => {
    if (pinnedNodeId) {
      setPinnedNodeId(null)
    } else if (targetNodeId) {
      setPinnedNodeId(targetNodeId)
    }
  }, [pinnedNodeId, targetNodeId, setPinnedNodeId])

  if (!visible) return null

  return (
    <div className={s.spreadsheetArea} style={{ width }}>
      <div className={s.resizeHandle} onMouseDown={handleResizeMouseDown} />
      <div className={s.header}>
        <span className={s.title}>Spreadsheet</span>
        <div className={s.controls}>
          {targetNodeId && (
            <>
              <span className={s.operatorName}>{targetNodeId}</span>
              <button
                type="button"
                className={s.pinButton}
                onClick={handleTogglePin}
                title={pinnedNodeId ? 'Unpin' : 'Pin current operator'}
              >
                <i className={pinnedNodeId ? 'pi pi-lock' : 'pi pi-lock-open'} />
              </button>
            </>
          )}
        </div>
      </div>
      <div className={s.content}>
        {error ? (
          <div className={s.emptyState}>{error}</div>
        ) : targetNodeId ? (
          <SpreadsheetViewer data={data} />
        ) : (
          <div className={s.emptyState}>Select a node to view its data</div>
        )}
      </div>
    </div>
  )
}
