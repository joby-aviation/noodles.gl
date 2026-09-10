import { useCallback, useEffect, useState } from 'react'
import { getOp, useUIStore } from '../../store'
import { SpreadsheetViewer } from './spreadsheet-viewer'
import s from './spreadsheet-pane.module.css'

// Rendered inside a resizable Panel in Layout, which also gates visibility
// on the spreadsheetVisible UI store flag
export function SpreadsheetPane({ selectedNodeIds }: { selectedNodeIds: string[] }) {
  const pinnedNodeId = useUIStore(state => state.pinnedSpreadsheetNodeId)
  const setPinnedNodeId = useUIStore(state => state.setPinnedSpreadsheetNodeId)

  const [data, setData] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)

  // Determine which operator to display (pinned or selected)
  const targetNodeId = pinnedNodeId || (selectedNodeIds.length === 1 ? selectedNodeIds[0] : null)

  // Subscribe to operator's first output field
  useEffect(() => {
    setData(null)
    setError(null)

    if (!targetNodeId) return

    const op = getOp(targetNodeId)
    if (!op) {
      setError('Operator not found')
      // Clear pinned node if it was deleted
      if (pinnedNodeId) setPinnedNodeId(null)
      return
    }

    const outputFields = Object.values(op.outputs)
    if (outputFields.length === 0) {
      setError('No outputs available')
      return
    }

    // Capture subscription in a local const so cleanup always unsubscribes the right one
    const sub = outputFields[0].subscribe(value => {
      setData(value)
      setError(null)
    })
    return () => sub.unsubscribe()
  }, [targetNodeId, pinnedNodeId, setPinnedNodeId])

  const handleTogglePin = useCallback(() => {
    setPinnedNodeId(pinnedNodeId ? null : targetNodeId)
  }, [pinnedNodeId, targetNodeId, setPinnedNodeId])

  return (
    <div className={s.spreadsheetArea}>
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
          <SpreadsheetViewer data={data} operatorId={targetNodeId} />
        ) : (
          <div className={s.emptyState}>Select a node to view its data</div>
        )}
      </div>
    </div>
  )
}
