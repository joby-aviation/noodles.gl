import type { IOperator, Operator } from '../operators'

// Host operators whose last run read the timeline (sequenceTime, frame): the host runner runs
// them again when the playhead moves.
const readers = new Set<string>()

export function subscribeOpToTimeline(op: Operator<IOperator>): void {
  readers.add(op.id)
}

export function unsubscribeOpFromTimeline(opId: string): void {
  readers.delete(opId)
}

export function readsTimeline(opId: string): boolean {
  return readers.has(opId)
}
