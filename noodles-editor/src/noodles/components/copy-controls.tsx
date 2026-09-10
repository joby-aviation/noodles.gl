import { type Node, useReactFlow } from '@xyflow/react'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'

import { debugUI } from '../../utils/debug'
import { useProjectModifications } from '../hooks/use-project-modifications'
import { getOpStore, useNestingStore } from '../store'
import type { GraphRef } from '../types'
import {
  type CopyPasteEdge,
  collectContainerChildren,
  collectGroupParents,
  identifyContainerChildren,
  remapPastedIds,
} from '../utils/copy-paste-utils'
import { type CopiedNodesJSON, safeStringify, serializeNodes } from '../utils/serialization'

export interface CopyControlsProps {
  graphRef: GraphRef
}

export interface CopyControlsRef {
  copy: () => void
  paste: () => void
  canCopy: () => boolean
  canPaste: () => boolean
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
  ({ graphRef }, ref) => {
    const { toObject, getNodes, getEdges, setNodes, setEdges, screenToFlowPosition } =
      useReactFlow()
    const currentContainerId = useNestingStore(state => state.currentContainerId)
    const mousePositionRef = useRef({ x: 0, y: 0 })
    const clipboardDataRef = useRef<string | null>(null)

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

      const { nodes, edges } = JSON.parse(data) as CopiedNodesJSON
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
      const flowPosition = screenToFlowPosition(mousePositionRef.current)
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
    }, [currentContainerId, screenToFlowPosition, applyModifications, getNodes])

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
      }
      window.addEventListener('mousemove', mouseMoveListener)
      return () => {
        window.removeEventListener('mousemove', mouseMoveListener)
      }
    }, [])

    useEffect(() => {
      const copyListener = (_e: ClipboardEvent) => {
        // Guard on copying text from inputs
        // Or e.sourceElement / e.target
        if (
          document.activeElement?.matches('input') ||
          document.activeElement?.matches('textarea')
        ) {
          return
        }
        doCopy()
      }

      const pasteListener = (e: ClipboardEvent) => {
        // Or e.sourceElement / e.target
        if (
          document.activeElement?.matches('input') ||
          document.activeElement?.matches('textarea')
        ) {
          return
        }

        const copied = e.clipboardData?.getData('text')
        if (!copied) {
          debugUI('Paste listener: No copied data found')
          return
        }

        clipboardDataRef.current = copied
        doPaste()
      }
      // TODO: use React Flow root element?
      window.addEventListener('copy', copyListener, false)
      window.addEventListener('paste', pasteListener, false)
      return () => {
        window.removeEventListener('copy', copyListener, false)
        window.removeEventListener('paste', pasteListener, false)
      }
    }, [doCopy, doPaste])

    return null
  }
)
