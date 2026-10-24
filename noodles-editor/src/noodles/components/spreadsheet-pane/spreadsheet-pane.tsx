import { useCallback, useEffect } from 'react'
import { useNodeRows } from '../../../editor/node-rows'
import { useUIStore } from '../../../editor/ui-store'
import s from './spreadsheet-pane.module.css'
import { SpreadsheetViewer } from './spreadsheet-viewer'

// Rendered inside a resizable Panel in Layout, which also gates visibility
// on the spreadsheetVisible UI store flag
export function SpreadsheetPane({ selectedNodeIds }: { selectedNodeIds: string[] }) {
  const pinnedNodeId = useUIStore(state => state.pinnedSpreadsheetNodeId)
  const setPinnedNodeId = useUIStore(state => state.setPinnedSpreadsheetNodeId)

  // The pinned node, else the one selected node
  const targetNodeId = pinnedNodeId || (selectedNodeIds.length === 1 ? selectedNodeIds[0] : null)
  const { name, data, total, note, error } = useNodeRows(targetNodeId)

  // A pinned node that was deleted stops being pinned
  useEffect(() => {
    if (pinnedNodeId && error === 'Node not found') setPinnedNodeId(null)
  }, [pinnedNodeId, error, setPinnedNodeId])

  const handleTogglePin = useCallback(() => {
    setPinnedNodeId(pinnedNodeId ? null : targetNodeId)
  }, [pinnedNodeId, targetNodeId, setPinnedNodeId])

  const shown = Array.isArray(data) ? data.length : 0
  return (
    <div className={s.spreadsheetArea}>
      <div className={s.header}>
        <span className={s.title}>Spreadsheet</span>
        <div className={s.controls}>
          {targetNodeId && (
            <>
              <span className={s.operatorName} title={note}>
                {name ?? targetNodeId}
                {total !== undefined && total > shown ? ` · first ${shown} of ${total}` : ''}
              </span>
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
