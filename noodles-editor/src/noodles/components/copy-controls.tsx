import { useReactFlow } from '@xyflow/react'
import { useEffect, useRef } from 'react'

import { useSlice } from '../store'
import { edgeId, nodeId } from '../utils/id-utils'
import { getBaseName } from '../utils/path-utils'
import { type CopiedNodesJSON, safeStringify, serializeNodes } from '../utils/serialization'

function copy(text: string) {
  const type = 'text/plain'
  const blob = new Blob([text], {
    type,
  })
  const data = [new ClipboardItem({ [type]: blob })]
  navigator.clipboard.write(data)
}

export function CopyControls() {
  const ops = useSlice(state => state.ops)
  const { toObject, addNodes, addEdges, screenToFlowPosition } = useReactFlow()
  const { currentContainerId } = useSlice(state => state.nesting)
  const mousePositionRef = useRef({ x: 0, y: 0 })

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
      if (document.activeElement?.matches('input') || document.activeElement?.matches('textarea')) {
        return
      }

      const { nodes: allGraphNodes, edges: allGraphEdges } = toObject()
      const selectedNodes = allGraphNodes.filter(n => n.selected)
      const selectedEdges = allGraphEdges.filter(e => e.selected)

      if (selectedNodes.length === 0 && selectedEdges.length === 0) return

      const nodesToCopySet = new Set(selectedNodes.map(n => n)) // Start with selected nodes
      const edgesToCopySet = new Set(selectedEdges.map(e => e)) // Start with selected edges

      for (const node of selectedNodes) {
        if (node.type === 'ContainerOp') {
          const children = allGraphNodes.filter(childNode => childNode.parentId === node.id)
          for (const child of children) {
            nodesToCopySet.add(child)
          }

          // Add edges connecting children within this container, or child to container
          const containerAndChildrenIds = new Set([node.id, ...children.map(c => c.id)])
          for (const edge of allGraphEdges) {
            if (
              containerAndChildrenIds.has(edge.source) &&
              containerAndChildrenIds.has(edge.target)
            ) {
              edgesToCopySet.add(edge)
            }
          }
        }
      }

      const nodesToCopy = Array.from(nodesToCopySet)
      const edgesToCopy = Array.from(edgesToCopySet)

      // sync op and node data
      const serializedNodes = serializeNodes(ops, nodesToCopy, edgesToCopy)

      copy(safeStringify({ nodes: serializedNodes, edges: edgesToCopy }))
    }

    const pasteListener = (e: ClipboardEvent) => {
      // Or e.sourceElement / e.target
      if (document.activeElement?.matches('input') || document.activeElement?.matches('textarea')) {
        return
      }

      const copied = e.clipboardData?.getData('text')
      if (!copied) {
        console.warn('Paste listener: No copied data found')
        return
      }

      // Try to parse as JSON, but don't fail if it's not valid JSON (e.g., plain text like API keys)
      let parsedData: CopiedNodesJSON
      try {
        parsedData = JSON.parse(copied)
      } catch {
        // Not valid JSON, ignore this paste event
        return
      }

      // Validate that it has the expected structure
      if (!parsedData.nodes || !parsedData.edges) {
        return
      }

      const { nodes, edges } = parsedData

      // update node ids to not conflict, and then remap edges to new node ids
      const idMap = new Map<string, string>()
      for (const node of nodes) {
        const baseName = getBaseName(node.id).replace(/-\d+$/, '') // scatter-1 -> scatter
        const newId = nodeId(baseName, currentContainerId)
        idMap.set(node.id, newId)
        node.id = newId
      }

      const deconflictedEdges = edges.map(edge => {
        const source = idMap.get(edge.source) || edge.source
        const target = idMap.get(edge.target) || edge.target
        return {
          ...edge,
          id: edgeId({ ...edge, source, target }),
          source,
          target,
        }
      })

      // Calculate the bounding box of copied nodes
      const [minX, minY] = nodes.reduce(
        ([minX, minY], { position }) => [Math.min(minX, position.x), Math.min(minY, position.y)],
        [Infinity, Infinity]
      )

      // Convert mouse position to flow coordinates
      const flowPosition = screenToFlowPosition(mousePositionRef.current)

      // Position nodes relative to cursor, maintaining their relative positions
      for (const node of nodes) {
        node.position.x = flowPosition.x + (node.position.x - minX)
        node.position.y = flowPosition.y + (node.position.y - minY)
      }

      addNodes(nodes)
      addEdges(deconflictedEdges)
    }
    // TODO: use React Flow root element?
    window.addEventListener('copy', copyListener, false)
    window.addEventListener('paste', pasteListener, false)
    return () => {
      window.removeEventListener('copy', copyListener, false)
      window.removeEventListener('paste', pasteListener, false)
    }
  }, [toObject, addNodes, addEdges, ops, currentContainerId, screenToFlowPosition])

  return null
}
