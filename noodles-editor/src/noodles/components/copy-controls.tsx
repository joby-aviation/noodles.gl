import { useReactFlow } from '@xyflow/react'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'

import { useProjectModifications } from '../hooks/use-project-modifications'
import { getOpStore, hasOp, useNestingStore } from '../store'
import { edgeId, nodeId } from '../utils/id-utils'
import { generateQualifiedPath, getBaseName } from '../utils/path-utils'
import { type CopiedNodesJSON, safeStringify, serializeNodes } from '../utils/serialization'

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

// Generate a unique node ID, checking both operators and existing React Flow nodes
// This is necessary because group nodes (e.g., ForLoop body) aren't operators
function uniqueNodeId(
  baseName: string,
  containerId: string | undefined,
  existingNodeIds: Set<string>
): string {
  // First try the standard nodeId function
  const newId = nodeId(baseName, containerId)

  // If nodeId returned a unique ID that doesn't conflict with existing nodes, use it
  if (!existingNodeIds.has(newId)) {
    return newId
  }

  // Otherwise, find a unique variant by appending numbers
  for (let i = 1; i < 100_000; i++) {
    const candidatePath = generateQualifiedPath(`${baseName}-${i}`, containerId)
    if (!existingNodeIds.has(candidatePath) && !hasOp(candidatePath)) {
      return candidatePath
    }
  }

  return newId // Fallback
}

export const CopyControls = forwardRef<CopyControlsRef>((_, ref) => {
  const { toObject, getNodes, getEdges, setNodes, setEdges, screenToFlowPosition } = useReactFlow()
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

    // Auto-include parent group nodes for children being copied (e.g., ForLoop body)
    let addedParent = true
    while (addedParent) {
      addedParent = false
      for (const node of nodesToCopySet) {
        if (node.parentId) {
          const parent = allGraphNodes.find(n => n.id === node.parentId)
          if (parent && parent.type === 'group' && !nodesToCopySet.has(parent)) {
            nodesToCopySet.add(parent)
            addedParent = true
          }
        }
      }
    }

    // Add edges for included group nodes (e.g., edges between ForLoop begin/end)
    for (const node of nodesToCopySet) {
      if (node.type === 'group') {
        const children = allGraphNodes.filter(childNode => childNode.parentId === node.id)
        const groupAndChildrenIds = new Set([node.id, ...children.map(c => c.id)])
        for (const edge of allGraphEdges) {
          if (groupAndChildrenIds.has(edge.source) && groupAndChildrenIds.has(edge.target)) {
            edgesToCopySet.add(edge)
          }
        }
      }
    }

    const nodesToCopy = Array.from(nodesToCopySet)
    const edgesToCopy = Array.from(edgesToCopySet)

    // sync op and node data
    const store = getOpStore()
    // Use forClipboard: true to preserve exact visual state (including fields visible due to connections)
    const serializedNodes = serializeNodes(store, nodesToCopy, edgesToCopy, { forClipboard: true })
    const data = safeStringify({ nodes: serializedNodes, edges: edgesToCopy })

    clipboardDataRef.current = data
    copy(data)
  }, [toObject])

  const doPaste = useCallback(() => {
    const data = clipboardDataRef.current
    if (!data) return

    const { nodes, edges } = JSON.parse(data) as CopiedNodesJSON

    // Sort nodes so parents come before children (ensures parent IDs are in idMap first)
    const sortedNodes = [...nodes].sort((a, b) => {
      // Group nodes (parents) should come first
      if (a.type === 'group' && b.type !== 'group') return -1
      if (b.type === 'group' && a.type !== 'group') return 1
      // If one is the parent of the other, parent comes first
      if (a.parentId === b.id) return 1
      if (b.parentId === a.id) return -1
      return 0
    })

    // Build set of existing node IDs (both operators and React Flow nodes like groups)
    const existingNodeIds = new Set(getNodes().map(n => n.id))

    // Build a map of node types for looking up parent types
    const nodeTypeMap = new Map(sortedNodes.map(n => [n.id, n.type]))

    // First pass: generate new IDs and populate idMap
    // ContainerOp children use the container ID as namespace
    // Group (ForLoop body) children stay as siblings (same namespace as group)
    const idMap = new Map<string, string>()
    for (const node of sortedNodes) {
      const baseName = getBaseName(node.id).replace(/-\d+$/, '') // scatter-1 -> scatter

      // Determine the containerId for generating the new ID
      // - ContainerOp: children are namespaced under the container
      // - group (ForLoop body): children are siblings, NOT namespaced under the group
      let containerId = currentContainerId
      if (node.parentId && idMap.has(node.parentId)) {
        const parentType = nodeTypeMap.get(node.parentId)
        // Only use parent as containerId for ContainerOp, not for group nodes
        if (parentType === 'ContainerOp') {
          containerId = idMap.get(node.parentId)!
        }
      }

      const newId = uniqueNodeId(baseName, containerId, existingNodeIds)
      idMap.set(node.id, newId)
      // Add new ID to existing set to avoid conflicts with subsequent nodes
      existingNodeIds.add(newId)
    }

    // Second pass: create nodes with remapped IDs and parentIds
    const pastedNodes = sortedNodes.map(node => {
      const newId = idMap.get(node.id)!
      const newParentId = node.parentId ? idMap.get(node.parentId) : undefined
      return { ...node, id: newId, parentId: newParentId }
    })

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

    // Calculate the bounding box of copied nodes (only top-level nodes for positioning)
    const topLevelNodes = pastedNodes.filter(n => !n.parentId)
    const [minX, minY] = topLevelNodes.reduce(
      ([minX, minY], { position }) => [Math.min(minX, position.x), Math.min(minY, position.y)],
      [Infinity, Infinity]
    )

    // Convert mouse position to flow coordinates
    const flowPosition = screenToFlowPosition(mousePositionRef.current)

    // Position top-level nodes relative to cursor, maintaining their relative positions
    // Child nodes keep their positions relative to their parent
    for (const node of pastedNodes) {
      if (!node.parentId) {
        node.position.x = flowPosition.x + (node.position.x - minX)
        node.position.y = flowPosition.y + (node.position.y - minY)
      }
    }

    // Use applyModifications to add nodes and edges atomically
    // This ensures nodes are in the array before edges are validated
    const modifications = [
      ...pastedNodes.map(node => ({ type: 'add_node' as const, data: node })),
      ...deconflictedEdges.map(edge => ({ type: 'add_edge' as const, data: edge })),
    ]

    const result = applyModifications(modifications)
    if (!result.success) {
      console.error('Failed to paste nodes:', result.error)
    }
    if (result.warnings) {
      console.warn('Paste warnings:', result.warnings)
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
      if (document.activeElement?.matches('input') || document.activeElement?.matches('textarea')) {
        return
      }
      doCopy()
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
})
