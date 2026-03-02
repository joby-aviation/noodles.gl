import { bindOperatorToTimeline, cleanupRemovedOperators } from '../timeline/field-bindings'
import type { IOperator, Operator } from './operators'

type CleanupFn = () => void

const bindings = new Map<string, CleanupFn>()

export function bindOperatorToTheatre(op: Operator<IOperator>, _sheet?: unknown): CleanupFn | null {
  const existing = bindings.get(op.id)
  if (existing) return existing

  const cleanup = bindOperatorToTimeline(op)
  if (!cleanup) return null

  bindings.set(op.id, cleanup)
  return () => {
    cleanup()
    bindings.delete(op.id)
  }
}

export function bindAllOperatorsToTheatre(
  operators: Operator<IOperator>[],
  _sheet?: unknown
): CleanupFn[] {
  return operators.map(op => bindOperatorToTheatre(op, _sheet)).filter(Boolean) as CleanupFn[]
}

export function unbindOperatorFromTheatre(opId: string, _sheet?: unknown): void {
  const cleanup = bindings.get(opId)
  if (cleanup) {
    cleanup()
    bindings.delete(opId)
  }
}

export function rebindOperatorToTheatre(op: Operator<IOperator>, _sheet?: unknown): void {
  unbindOperatorFromTheatre(op.id, _sheet)
  bindOperatorToTheatre(op, _sheet)
}

export function cleanupRemovedOperatorsTheatre(currentOperatorIds: Set<string>): void {
  cleanupRemovedOperators(currentOperatorIds)
}

export function clearTheatreBindings(): void {
  for (const cleanup of bindings.values()) {
    cleanup()
  }
  bindings.clear()
}

export { cleanupRemovedOperators }
