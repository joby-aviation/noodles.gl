import { type Node, type OnNodesChange, useReactFlow, useStore } from '@xyflow/react'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'

import { analytics } from '../../utils/analytics'
import { debugUI } from '../../utils/debug'
import { useProjectModifications } from '../hooks/use-project-modifications'
import { getOpStore, useNestingStore } from '../store'
import {
  isGraphClipboard,
  parseTableClipboard,
  TABLE_RANGE_CLIPBOARD_MIME,
} from '../table-data-clipboard'
import type { GraphRef } from '../types'
import {
  collectContainerChildren,
  collectGroupParents,
  identifyContainerChildren,
  remapPastedIds,
  uniqueNodeId,
} from '../utils/copy-paste-utils'
import { type CopiedNodesJSON, safeStringify, serializeNodes } from '../utils/serialization'
import {
  createTableImportRequest,
  TableImportDialog,
  type TableImportRequest,
  type TableImportResult,
} from './table-import-dialog'

export interface CopyControlsProps {
  graphRef: GraphRef
  onNodesChange: OnNodesChange
}

export interface CopyControlsRef {
  copy: () => void
  paste: () => void
  canCopy: () => boolean
  canPaste: () => boolean
}

/** Parse graph clipboard JSON without claiming arbitrary clipboard text. */
export function parseGraphClipboard(text: string): CopiedNodesJSON | undefined {
  try {
    const parsed: unknown = JSON.parse(text)
    return isGraphClipboard(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function eventPathContains(event: Event, selector: string): boolean {
  return event.composedPath().some(target => target instanceof Element && target.matches(selector))
}

function tableOwnsClipboardEvent(event: ClipboardEvent): boolean {
  return eventPathContains(event, '[data-table-editor-grid="true"]')
}

function eventTargetsEmptyCanvas(event: ClipboardEvent): boolean {
  return (
    eventPathContains(event, '.react-flow__pane') && !eventPathContains(event, '.react-flow__node')
  )
}

function nativeEditorOwnsClipboardEvent(event: ClipboardEvent): boolean {
  return event.composedPath().some(target => {
    if (!(target instanceof HTMLElement)) return false
    return target.matches('input, textarea, [contenteditable="true"]') || target.isContentEditable
  })
}

function dialogOwnsClipboardEvent(event: ClipboardEvent): boolean {
  return (
    eventPathContains(event, '[role="dialog"]') ||
    Boolean(document.activeElement?.closest('[role="dialog"]'))
  )
}

function copy(text: string) {
  const type = 'text/plain'
  const blob = new Blob([text], {
    type,
  })
  const data = [new ClipboardItem({ [type]: blob })]
  navigator.clipboard.write(data)
}

export const CopyControls = forwardRef<CopyControlsRef, CopyControlsProps>(
  ({ graphRef, onNodesChange }, ref) => {
    const { toObject, getNodes, getEdges, setNodes, setEdges, screenToFlowPosition } =
      useReactFlow()
    const currentContainerId = useNestingStore(state => state.currentContainerId)
    const mousePositionRef = useRef<{ x: number; y: number } | null>(null)
    const mouseOverEmptyCanvasRef = useRef<boolean | null>(null)
    const clipboardDataRef = useRef<string | null>(null)
    const pendingCanvasPositionRef = useRef<{ x: number; y: number } | null>(null)
    const pendingContainerIdRef = useRef(currentContainerId)
    const [tableImportRequest, setTableImportRequest] = useState<TableImportRequest>()

    const getPasteScreenPosition = useCallback(() => {
      if (mousePositionRef.current) return mousePositionRef.current

      const pane = document.querySelector<HTMLElement>('.react-flow__pane')
      const bounds = pane?.getBoundingClientRect()
      if (bounds && bounds.width > 0 && bounds.height > 0) {
        return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }
      }

      return { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    }, [])

    // Use shared hook for project modifications to properly handle nodes + edges atomically
    const { applyModifications } = useProjectModifications({
      getNodes: useCallback(() => getNodes(), [getNodes]),
      getEdges: useCallback(() => getEdges(), [getEdges]),
      setNodes,
      setEdges,
    })

    const hasSelectedNodes = useCallback(() => {
      const { nodes } = toObject()
      return nodes.some(n => n.selected)
    }, [toObject])

    const doCopy = useCallback(() => {
      const { nodes: allGraphNodes, edges: allGraphEdges } = toObject()
      const selectedNodes = allGraphNodes.filter(n => n.selected)
      const selectedEdges = allGraphEdges.filter(e => e.selected)

      if (selectedNodes.length === 0 && selectedEdges.length === 0) return

      const nodesToCopySet = new Set(selectedNodes.map(n => n))
      const edgesToCopySet = new Set(selectedEdges.map(e => e))

      // Container children use path-based nesting and live in a different scope
      const fullNodes = graphRef.current.nodes
      const fullEdges = graphRef.current.edges
      const { additionalNodes: containerChildren, additionalEdges: containerEdges } =
        collectContainerChildren(selectedNodes, fullNodes, fullEdges)
      for (const child of containerChildren) nodesToCopySet.add(child)
      for (const edge of containerEdges) edgesToCopySet.add(edge)

      // Auto-include parent group nodes (ForLoop body) and their edges
      const { additionalNodes: groupParents, additionalEdges: groupEdges } = collectGroupParents(
        nodesToCopySet,
        allGraphNodes,
        allGraphEdges
      )
      for (const node of groupParents) nodesToCopySet.add(node)
      for (const edge of groupEdges) edgesToCopySet.add(edge)

      const nodesToCopy = Array.from(nodesToCopySet)
      const edgesToCopy = Array.from(edgesToCopySet)

      const store = getOpStore()
      const serializedNodes = serializeNodes(store, nodesToCopy, edgesToCopy, {
        forClipboard: true,
      })
      const data = safeStringify({ nodes: serializedNodes, edges: edgesToCopy })

      clipboardDataRef.current = data
      copy(data)
    }, [toObject, graphRef])

    const doPaste = useCallback(() => {
      const data = clipboardDataRef.current
      if (!data) return

      const graph = parseGraphClipboard(data)
      if (!graph) return
      const { nodes, edges } = graph
      const existingNodeIds = new Set(getNodes().map(n => n.id))
      const copiedNodeIds = new Set(nodes.map(n => n.id))

      const {
        nodes: pastedNodes,
        edges: deconflictedEdges,
        idMap,
      } = remapPastedIds(nodes, edges, currentContainerId, existingNodeIds)

      const containerChildIds = identifyContainerChildren(pastedNodes, idMap, copiedNodeIds)

      // Position top-level nodes relative to cursor, maintaining relative positions
      const topLevelNodes = pastedNodes.filter(n => !n.parentId && !containerChildIds.has(n.id))
      const [minX, minY] = topLevelNodes.reduce(
        ([minX, minY], { position }) => [Math.min(minX, position.x), Math.min(minY, position.y)],
        [Infinity, Infinity]
      )
      const flowPosition = screenToFlowPosition(getPasteScreenPosition())
      for (const node of pastedNodes) {
        if (!node.parentId && !containerChildIds.has(node.id)) {
          node.position.x = flowPosition.x + (node.position.x - minX)
          node.position.y = flowPosition.y + (node.position.y - minY)
        }
      }

      const modifications = [
        ...pastedNodes.map(node => ({ type: 'add_node' as const, data: node })),
        ...deconflictedEdges.map(edge => ({ type: 'add_edge' as const, data: edge })),
      ]

      const result = applyModifications(modifications)
      if (!result.success) {
        debugUI('Failed to paste nodes:', result.error)
      }
      if (result.warnings) {
        debugUI('Paste warnings:', result.warnings)
      }
    }, [
      currentContainerId,
      screenToFlowPosition,
      applyModifications,
      getNodes,
      getPasteScreenPosition,
    ])

    const confirmTableImport = useCallback(
      (result: TableImportResult) => {
        const existingNodes = getNodes()
        const currentNodeIds = new Set(existingNodes.map(node => node.id))
        const containerId = pendingContainerIdRef.current
        const screenPosition = pendingCanvasPositionRef.current ?? getPasteScreenPosition()
        const position = screenToFlowPosition(screenPosition)
        const tableNode: Node<Record<string, unknown>> = {
          id: uniqueNodeId('table-editor', containerId, currentNodeIds),
          type: 'TableEditorOp',
          position,
          selected: true,
          data: {
            inputs: {
              schema: result.schema,
              data: result.data,
            },
          },
        }
        onNodesChange([{ type: 'add', item: tableNode }])
        analytics.track('table_clipboard_action', {
          action: 'paste',
          source: 'canvas',
          format: result.format,
          rowCount: result.data.length,
          columnCount: result.schema.columns.length,
          success: true,
        })
        setTableImportRequest(undefined)
        pendingCanvasPositionRef.current = null
      },
      [getNodes, getPasteScreenPosition, onNodesChange, screenToFlowPosition]
    )

    useImperativeHandle(
      ref,
      () => ({
        copy: doCopy,
        paste: doPaste,
        canCopy: hasSelectedNodes,
        canPaste: () => clipboardDataRef.current !== null,
      }),
      [doCopy, doPaste, hasSelectedNodes]
    )

    useEffect(() => {
      const mouseMoveListener = (e: MouseEvent) => {
        mousePositionRef.current = { x: e.clientX, y: e.clientY }
        const target = e.target
        mouseOverEmptyCanvasRef.current =
          target instanceof Element &&
          target.closest('.react-flow__pane') !== null &&
          target.closest('.react-flow__node') === null
      }
      const mouseLeaveListener = () => {
        mouseOverEmptyCanvasRef.current = false
      }
      const focusInListener = (event: FocusEvent) => {
        const target = event.target
        if (!(target instanceof Element) || target.closest('.react-flow__pane') === null) {
          mouseOverEmptyCanvasRef.current = false
        }
      }
      window.addEventListener('mousemove', mouseMoveListener)
      window.addEventListener('mouseleave', mouseLeaveListener)
      window.addEventListener('focusin', focusInListener)
      return () => {
        window.removeEventListener('mousemove', mouseMoveListener)
        window.removeEventListener('mouseleave', mouseLeaveListener)
        window.removeEventListener('focusin', focusInListener)
      }
    }, [])

    useEffect(() => {
      const copyListener = (e: ClipboardEvent) => {
        if (
          e.defaultPrevented ||
          tableOwnsClipboardEvent(e) ||
          nativeEditorOwnsClipboardEvent(e) ||
          dialogOwnsClipboardEvent(e) ||
          document.activeElement?.matches('input, textarea, [contenteditable="true"]')
        ) {
          return
        }
        doCopy()
      }

      const pasteListener = (e: ClipboardEvent) => {
        if (tableImportRequest) return
        if (
          e.defaultPrevented ||
          tableOwnsClipboardEvent(e) ||
          nativeEditorOwnsClipboardEvent(e) ||
          dialogOwnsClipboardEvent(e) ||
          document.activeElement?.matches('input, textarea, [contenteditable="true"]')
        ) {
          return
        }

        const copied = e.clipboardData?.getData('text/plain') ?? ''
        const html = e.clipboardData?.getData('text/html') ?? ''
        const richText = e.clipboardData?.getData(TABLE_RANGE_CLIPBOARD_MIME) ?? ''
        if (!copied && !html && !richText) {
          debugUI('Paste listener: No copied data found')
          return
        }

        const parsed = parseTableClipboard(
          {
            plainText: copied,
            html,
            richText,
          },
          { allowScalar: false }
        )
        if (parsed.kind === 'graph') {
          e.preventDefault()
          clipboardDataRef.current = copied
          doPaste()
          return
        }
        if (parsed.kind !== 'table') return
        const columnCount = parsed.rows.reduce((max, row) => Math.max(max, row.length), 0)
        if (parsed.rows.length === 0 || columnCount === 0) return
        if (mouseOverEmptyCanvasRef.current !== true && !eventTargetsEmptyCanvas(e)) return

        e.preventDefault()
        pendingCanvasPositionRef.current = getPasteScreenPosition()
        pendingContainerIdRef.current = currentContainerId
        setTableImportRequest(createTableImportRequest(parsed, 'canvas'))
      }
      // TODO: use React Flow root element?
      window.addEventListener('copy', copyListener, false)
      window.addEventListener('paste', pasteListener, false)
      return () => {
        window.removeEventListener('copy', copyListener, false)
        window.removeEventListener('paste', pasteListener, false)
      }
    }, [currentContainerId, doCopy, doPaste, getPasteScreenPosition, tableImportRequest])

    return (
      <TableImportDialog
        open={tableImportRequest !== undefined}
        request={tableImportRequest}
        onOpenChange={open => {
          if (!open) {
            setTableImportRequest(undefined)
            pendingCanvasPositionRef.current = null
          }
        }}
        onConfirm={confirmTableImport}
      />
    )
  }
)

/**
 * Connects CopyControls to React Flow's active node-change handler. The handler may be
 * decorated by UndoRedoHandler after ReactFlow mounts, so subscribing here keeps canvas
 * imports on the same undo-aware mutation path as other graph edits.
 */
export const ConnectedCopyControls = forwardRef<
  CopyControlsRef,
  Omit<CopyControlsProps, 'onNodesChange'>
>((props, ref) => {
  const onNodesChange = useStore(state => state.onNodesChange)
  if (!onNodesChange) return null
  return <CopyControls {...props} ref={ref} onNodesChange={onNodesChange} />
})
