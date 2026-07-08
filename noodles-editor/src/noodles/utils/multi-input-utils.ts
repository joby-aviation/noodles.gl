// Multi-input (Blender-style) connection ordering utilities.
// The single source of truth for connection order is the EDGE ARRAY ORDER: an edge's
// position among the edges sharing its (target, targetHandle) defines its slot. The
// `orderIndex`/`groupSize` written into edge.data by normalizeMultiInputEdges are derived
// caches for rendering only — never mutate them directly; re-run the normalizer instead.
import type { Edge as ReactFlowEdge } from '@xyflow/react'
import { ListField } from '../fields'
import { getOp } from '../store'
import { parseHandleId } from './path-utils'

export const MULTI_INPUT_EDGE_TYPE = 'MultiInputEdge'

// Slot geometry shared by MultiInputHandle (slot drawing, hit testing) and
// MultiInputEdgeComponent (edge anchor offsets) so the two can't drift apart
export const SLOT_HEIGHT = 6
export const SLOT_GAP = 1.5
export const SLOT_SPACING = SLOT_HEIGHT + SLOT_GAP

export interface MultiInputEdgeData extends Record<string, unknown> {
  orderIndex: number
  groupSize: number
}

export type EdgeTargetRef = Pick<ReactFlowEdge, 'target' | 'targetHandle'>
export type IsMultiInputTarget = (edge: EdgeTargetRef) => boolean

// An edge is a multi-input edge when its target handle points at a ListField input.
// Resolved against the live operator registry; tests can inject their own resolver.
export function isListFieldTarget(edge: EdgeTargetRef): boolean {
  const handleInfo = parseHandleId(edge.targetHandle || '')
  if (!handleInfo || handleInfo.namespace !== 'par') return false
  return getOp(edge.target)?.inputs[handleInfo.fieldName] instanceof ListField
}

const groupKey = (edge: EdgeTargetRef) => `${edge.target}::${edge.targetHandle}`

// Rewrites derived multi-input state from edge array order: every edge targeting a
// multi-input handle gets type MULTI_INPUT_EDGE_TYPE and data.{orderIndex, groupSize};
// edges that no longer target one get the stale type/data stripped. Returns the same
// array reference when nothing changed so callers can avoid redundant state updates.
export function normalizeMultiInputEdges<E extends ReactFlowEdge>(
  edges: E[],
  isMultiInputTarget: IsMultiInputTarget = isListFieldTarget
): E[] {
  const groupSizes = new Map<string, number>()
  for (const edge of edges) {
    if (isMultiInputTarget(edge)) {
      const key = groupKey(edge)
      groupSizes.set(key, (groupSizes.get(key) ?? 0) + 1)
    }
  }

  const nextIndex = new Map<string, number>()
  let changed = false
  const next = edges.map(edge => {
    const groupSize = groupSizes.get(groupKey(edge))

    if (groupSize === undefined) {
      if (edge.type !== MULTI_INPUT_EDGE_TYPE) return edge
      changed = true
      // Omit the keys entirely (not `type: undefined`) so the shape matches a freshly
      // created edge for both `edge.type` and `'type' in edge` style guards
      const { type: _type, data: oldData, ...rest } = edge
      const { orderIndex: _o, groupSize: _g, ...data } = (oldData ?? {}) as Record<
        string,
        unknown
      >
      return (Object.keys(data).length > 0 ? { ...rest, data } : rest) as unknown as E
    }

    const orderIndex = nextIndex.get(groupKey(edge)) ?? 0
    nextIndex.set(groupKey(edge), orderIndex + 1)

    const data = edge.data as Partial<MultiInputEdgeData> | undefined
    if (
      edge.type === MULTI_INPUT_EDGE_TYPE &&
      data?.orderIndex === orderIndex &&
      data?.groupSize === groupSize
    ) {
      return edge
    }
    changed = true
    return {
      ...edge,
      type: MULTI_INPUT_EDGE_TYPE,
      data: { ...edge.data, orderIndex, groupSize },
    }
  })

  return changed ? next : edges
}

// Edge ids for a handle in slot order (array order IS slot order)
export function orderedEdgeIdsForHandle(
  edges: ReactFlowEdge[],
  target: string,
  targetHandle: string | null | undefined
): string[] {
  return edges
    .filter(e => e.target === target && e.targetHandle === targetHandle)
    .map(e => e.id)
}

// Insert `edge` so it becomes the index-th member of its (target, targetHandle) group.
// index is clamped to [0, groupSize]; index >= groupSize appends after the last member.
export function insertEdgeAtGroupIndex<E extends ReactFlowEdge>(
  edges: E[],
  edge: E,
  index: number
): E[] {
  const groupPositions: number[] = []
  edges.forEach((e, i) => {
    if (e.target === edge.target && e.targetHandle === edge.targetHandle) {
      groupPositions.push(i)
    }
  })

  const clamped = Math.max(0, Math.min(index, groupPositions.length))
  const insertAt = clamped < groupPositions.length ? groupPositions[clamped] : edges.length
  const next = [...edges]
  next.splice(insertAt, 0, edge)
  return next
}

// Move an existing edge to slot `toIndex` within its group (index measured after removal,
// clamped). Returns the same array reference when the edge already occupies that slot.
export function moveEdgeWithinGroup<E extends ReactFlowEdge>(
  edges: E[],
  edgeId: string,
  toIndex: number
): E[] {
  const from = edges.findIndex(e => e.id === edgeId)
  if (from === -1) return edges

  const edge = edges[from]
  const groupIds = orderedEdgeIdsForHandle(edges, edge.target, edge.targetHandle)
  const currentIndex = groupIds.indexOf(edgeId)
  const clamped = Math.max(0, Math.min(toIndex, groupIds.length - 1))
  if (clamped === currentIndex) return edges

  const without = [...edges]
  without.splice(from, 1)
  return insertEdgeAtGroupIndex(without, edge, clamped)
}

// Vertical offset of slot `orderIndex` from the handle's center, with slots centered as a
// group: slotOffsetY(0, 1) === 0, slots spread symmetrically for larger groups
export function slotOffsetY(orderIndex: number, groupSize: number): number {
  return (orderIndex - (groupSize - 1) / 2) * SLOT_SPACING
}

// Map a pointer y to an insertion boundary in [0, groupSize]. Boundary i sits between
// slot i-1 and slot i at (i - groupSize/2) * SLOT_SPACING from the handle center.
// Both coordinates must be in the same space (flow coordinates — zoom independent).
export function insertionIndexFromPointerY(
  pointerY: number,
  handleCenterY: number,
  groupSize: number
): number {
  if (groupSize <= 0) return 0
  const raw = (pointerY - handleCenterY) / SLOT_SPACING + groupSize / 2
  return Math.max(0, Math.min(groupSize, Math.round(raw)))
}
