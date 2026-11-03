// Pasting onto the network: nodes copied in this tab or another, or a table copied from a
// spreadsheet or a web page, which becomes a Table node once the import dialog confirms its
// columns. Text fields, dialogs and table grids keep their own pastes.

import { useReactFlow } from '@xyflow/react'
import { useEffect, useRef, useState } from 'react'
import {
  createTableImportRequest,
  TableImportDialog,
  type TableImportRequest,
  type TableImportResult,
} from '../noodles/components/table-import-dialog'
import { parseTableClipboard, TABLE_RANGE_CLIPBOARD_MIME } from '../noodles/table-data-clipboard'
import { analytics } from '../utils/analytics'
import { pasteInPage, pasteText } from './doc-network'
import { addNode, setParam } from './doc-ops'
import { docStore } from './doc-store'

const pathHas = (event: Event, selector: string) =>
  event.composedPath().some(target => target instanceof Element && target.matches(selector))

// A paste something else on the page handles
function ownedElsewhere(event: ClipboardEvent): boolean {
  const active = document.activeElement
  return (
    event.defaultPrevented ||
    pathHas(event, '[data-table-editor-grid="true"]') ||
    pathHas(event, '[role="dialog"]') ||
    !!active?.closest('[role="dialog"]') ||
    event
      .composedPath()
      .some(
        t =>
          t instanceof HTMLElement &&
          (t.matches('input, textarea, [contenteditable="true"]') || t.isContentEditable)
      )
  )
}

export function CanvasPaste() {
  const { screenToFlowPosition } = useReactFlow()
  const [request, setRequest] = useState<TableImportRequest>()
  const pointer = useRef<{ x: number; y: number } | null>(null)
  const overCanvas = useRef(false)
  // Where the table goes: where the pointer was when it was pasted
  const dropAt = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY }
      const target = e.target
      overCanvas.current =
        target instanceof Element &&
        !!target.closest('.react-flow__pane') &&
        !target.closest('.react-flow__node')
    }
    const onLeave = () => {
      overCanvas.current = false
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseleave', onLeave)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseleave', onLeave)
    }
  }, [])

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (request || ownedElsewhere(e)) return
      const text = e.clipboardData?.getData('text/plain') ?? ''
      const html = e.clipboardData?.getData('text/html') ?? ''
      const richText = e.clipboardData?.getData(TABLE_RANGE_CLIPBOARD_MIME) ?? ''
      // Copied nodes paste wherever the network has the keyboard. A range copied from a
      // table grid is the more specific format, so it wins over JSON-looking text.
      if (!richText && pasteText(text)) {
        e.preventDefault()
        return
      }
      const onCanvas =
        overCanvas.current || (pathHas(e, '.react-flow__pane') && !pathHas(e, '.react-flow__node'))
      if (onCanvas && (text || html || richText)) {
        const parsed = parseTableClipboard(
          { plainText: text, html, richText },
          { allowScalar: false }
        )
        const columns =
          parsed.kind === 'table' ? Math.max(0, ...parsed.rows.map(row => row.length)) : 0
        if (parsed.kind === 'table' && parsed.rows.length > 0 && columns > 0) {
          e.preventDefault()
          dropAt.current = pointer.current
          setRequest(createTableImportRequest(parsed, 'canvas'))
          return
        }
      }
      if (pathHas(e, '.react-flow-wrapper') && pasteInPage()) e.preventDefault()
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [request])

  const close = () => {
    setRequest(undefined)
    dropAt.current = null
  }

  const confirm = (result: TableImportResult) => {
    const pane = document.querySelector<HTMLElement>('.react-flow__pane')?.getBoundingClientRect()
    const screen = dropAt.current ??
      (pane && { x: pane.left + pane.width / 2, y: pane.top + pane.height / 2 }) ?? {
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      }
    const at = screenToFlowPosition(screen)
    const store = docStore()
    let created: string | undefined
    store.edit(d => {
      const node = addNode(d, 'table', at.x, at.y, store.get().network)
      setParam(d, node.id, 'rows', JSON.stringify(result.data, null, 2))
      setParam(d, node.id, 'schema', JSON.stringify(result.schema))
      created = node.id
    })
    if (created) store.set({ selection: [created] })
    analytics.track('table_clipboard_action', {
      action: 'paste',
      source: 'canvas',
      format: result.format,
      rowCount: result.data.length,
      columnCount: result.schema.columns.length,
      success: true,
    })
    close()
  }

  return (
    <TableImportDialog
      open={request !== undefined}
      request={request}
      onOpenChange={open => {
        if (!open) close()
      }}
      onConfirm={confirm}
    />
  )
}
