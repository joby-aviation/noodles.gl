import type { NodeJSON } from 'SKIP-@xyflow/react'
import type {
  Edge as ReactFlowEdge,
  ReactFlowJsonObject,
  Node as ReactFlowNode,
} from '@xyflow/react'
import { isEqual } from 'lodash'

import { resizeableNodes } from '../components/op-components'
import type { NoodlesContextValue } from '../store'
import type { ExtractProps } from './extract-props'
import { parseHandleId } from './path-utils'

export { NOODLES_VERSION } from './migrate-schema'

export type NoodlesProjectJSON = ReactFlowJsonObject & {
  version: number
  timeline: Record<string, unknown>
}
export type CopiedNodesJSON = Omit<ReactFlowJsonObject, 'viewport'>

export const EMPTY_PROJECT: NoodlesProjectJSON = {
  version: 0,
  timeline: {},
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
}

// Replace functions and circular references
function getJsonSanitizer() {
  const seen = new Set()
  return (_key: string, value: unknown) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return undefined
      }
      seen.add(value)
    } else if (typeof value === 'function') {
      return undefined
    }
    return value
  }
}

export function safeStringify(obj: Record<string, unknown>) {
  return JSON.stringify(obj, getJsonSanitizer(), 2)
}

export function serializeNodes(
  ops: NoodlesContextValue['ops'],
  nodes: ReactFlowNode<Record<string, unknown>>[],
  edges: ReactFlowEdge[]
) {
  // Make a copy of the node to prepared for serialization.
  const preparedNodes: NodeJSON<unknown>[] = []
  for (const node of nodes) {
    if (node.type === 'group') {
      // Include visual aid nodes (e.g. for loops) as-is
      preparedNodes.push(node)
      continue
    }
    const op = ops.get(node.id)
    if (!op) continue

    // Don't set node data for connected inputs (saves space) except if upstream op is locked
    const incomers = edges
      .filter(edge => edge.target === node.id && edge.type !== 'ReferenceEdge')
      .filter(edge => ops.get(edge.source)?.locked?.value === false)
      .map(edge => parseHandleId(edge.targetHandle)?.fieldName)
      .reduce((acc, fieldName) => acc.add(fieldName), new Set())

    // Serialize fields
    const inputs: ExtractProps<ReturnType<typeof op.createInputs>> = {}
    for (const [name, field] of Object.entries(op.inputs)) {
      const serialized = field.serialize()
      if (
        serialized !== undefined &&
        !isEqual(serialized, field.defaultValue) &&
        !incomers.has(name)
      ) {
        inputs[name] = serialized
      }
    }

    // Clean up the node object to remove unnecessary properties (they're recreated on load)
    const {
      selected: _,
      dragging: __,
      hidden: ___,
      dragHandle: ____,
      measured,
      width,
      height,
      ...cleanedNode
    } = node

    preparedNodes.push({
      ...cleanedNode,
      ...(resizeableNodes.includes(node.type) ? { width, height, measured } : {}),
      data: {
        inputs,
        locked: op.locked.value,
      },
    })
  }
  return preparedNodes
}

export function serializeEdges(
  _ops: NoodlesContextValue['ops'],
  nodes: ReactFlowNode<Record<string, unknown>>[],
  edges: ReactFlowEdge[]
) {
  // Create a set of valid node IDs to filter out orphaned edges
  const validNodeIds = new Set(nodes.map(node => node.id))

  return edges
    .filter(edge => {
      // Skip edges that reference non-existent nodes
      if (!validNodeIds.has(edge.source) || !validNodeIds.has(edge.target)) {
        console.warn(
          `Skipping orphaned edge during serialization: ${edge.id} (${edge.source} -> ${edge.target})`
        )
        return false
      }
      return true
    })
    .map(edge =>
      Object.fromEntries(
        Object.entries(edge).filter(([key]) => !['selected', 'animated'].includes(key))
      )
    )
}
