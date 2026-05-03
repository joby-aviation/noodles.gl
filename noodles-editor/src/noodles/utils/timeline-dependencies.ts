import { debugDirty } from '../../utils/debug'
import { useTimelineStore } from '../../timeline/timeline-store'
import type { Operator, IOperator } from '../operators'
import type { TimelineVariable } from './timeline-context'

class TimelineDependencyManager {
  private dependencies = new Map<string, Set<TimelineVariable>>()
  private subscriptions = new Map<string, (() => void)[]>()

  trackDependencies(opId: string, variables: Set<TimelineVariable>): void {
    this.dependencies.set(opId, variables)
  }

  subscribe(op: Operator<IOperator>): void {
    const dependencies = this.dependencies.get(op.id)
    if (!dependencies || dependencies.size === 0) return

    this.unsubscribe(op.id)

    const cleanupFns: (() => void)[] = []

    // Subscribe to position changes if sequenceTime, frame, or totalFrames is used
    if (
      dependencies.has('sequenceTime') ||
      dependencies.has('frame') ||
      dependencies.has('totalFrames')
    ) {
      const unsub = useTimelineStore.subscribe(
        (state) => ({ position: state.position, fps: state.sequence.fps }),
        () => {
          debugDirty('%s marked dirty by timeline position change', op.id)
          op.markDirty()
        },
        { equalityFn: (a, b) => a.position === b.position && a.fps === b.fps }
      )
      cleanupFns.push(unsub)
    }

    // Subscribe to sequence changes if sequence is used
    if (dependencies.has('sequence')) {
      const unsub = useTimelineStore.subscribe(
        (state) => state.sequence,
        () => {
          debugDirty('%s marked dirty by timeline sequence change', op.id)
          op.markDirty()
        },
        { equalityFn: (a, b) => a.length === b.length && a.fps === b.fps }
      )
      cleanupFns.push(unsub)
    }

    this.subscriptions.set(op.id, cleanupFns)
  }

  unsubscribe(opId: string): void {
    const cleanupFns = this.subscriptions.get(opId)
    if (cleanupFns) {
      cleanupFns.forEach((fn) => fn())
      this.subscriptions.delete(opId)
    }
    this.dependencies.delete(opId)
  }

  getDependencies(opId: string): Set<TimelineVariable> | undefined {
    return this.dependencies.get(opId)
  }
}

export const timelineDependencyManager = new TimelineDependencyManager()
