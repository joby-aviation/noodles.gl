import { useEffect, useMemo } from 'react'
import { OutOp } from '../operators'
import { useActiveOutOpStore, useOperatorStore } from '../store'

/**
 * Hook to manage the "active" OutOp - similar to Blender's active camera concept.
 *
 * This provides a sticky/persistent selection that is independent of node selection
 * and drives the render settings pipeline.
 *
 * Features:
 * - Auto-selects the first OutOp if none is active
 * - Promotes the next OutOp if the active one is deleted
 * - Returns null only when no OutOps exist
 */
export function useActiveOutOp(): OutOp | null {
  const operators = useOperatorStore(state => state.operators)
  const activeOutOpId = useActiveOutOpStore(state => state.activeOutOpId)
  const setActiveOutOpId = useActiveOutOpStore(state => state.setActiveOutOpId)

  // Get all OutOps sorted by ID for consistent ordering
  const outOps = useMemo(() => {
    return Array.from(operators.values())
      .filter((op): op is OutOp => op instanceof OutOp)
      .sort((a, b) => a.id.localeCompare(b.id))
  }, [operators])

  // Auto-select first OutOp if none is active
  useEffect(() => {
    if (!activeOutOpId && outOps.length > 0) {
      setActiveOutOpId(outOps[0].id)
    }
  }, [activeOutOpId, outOps, setActiveOutOpId])

  // If active OutOp was deleted, promote the next one
  useEffect(() => {
    if (activeOutOpId && !outOps.find(op => op.id === activeOutOpId)) {
      setActiveOutOpId(outOps.length > 0 ? outOps[0].id : null)
    }
  }, [activeOutOpId, outOps, setActiveOutOpId])

  return outOps.find(op => op.id === activeOutOpId) ?? null
}

/**
 * Get all OutOps in the project, useful for UI that lists available outputs.
 */
export function useAllOutOps(): OutOp[] {
  const operators = useOperatorStore(state => state.operators)

  return useMemo(() => {
    return Array.from(operators.values())
      .filter((op): op is OutOp => op instanceof OutOp)
      .sort((a, b) => a.id.localeCompare(b.id))
  }, [operators])
}
