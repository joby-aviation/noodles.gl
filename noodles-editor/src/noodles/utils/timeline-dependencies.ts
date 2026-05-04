import { create } from 'zustand'
import { debugDirty } from '../../utils/debug'
import { useTimelineStore } from '../../timeline/timeline-store'
import type { Operator, IOperator } from '../operators'

interface TimelineDependencyState {
  subscriptions: Map<string, (() => void)[]>
  subscribe: (op: Operator<IOperator>) => void
  unsubscribe: (opId: string) => void
}

export const useTimelineDependencyStore = create<TimelineDependencyState>((set, get) => ({
  subscriptions: new Map(),

  subscribe: (op: Operator<IOperator>) => {
    const { subscriptions, unsubscribe } = get()

    // Clean up any existing subscriptions
    unsubscribe(op.id)

    const cleanupFns: (() => void)[] = []

    // Subscribe to position changes (affects sequenceTime, frame, totalFrames)
    const posUnsub = useTimelineStore.subscribe(
      (state) => ({ position: state.position, fps: state.sequence.fps }),
      () => {
        debugDirty('%s marked dirty by timeline position/fps change', op.id)
        op.markDirty()
      },
      { equalityFn: (a, b) => a.position === b.position && a.fps === b.fps }
    )
    cleanupFns.push(posUnsub)

    // Subscribe to sequence changes (affects sequence, totalFrames)
    const seqUnsub = useTimelineStore.subscribe(
      (state) => state.sequence,
      () => {
        debugDirty('%s marked dirty by timeline sequence change', op.id)
        op.markDirty()
      },
      { equalityFn: (a, b) => a.length === b.length && a.fps === b.fps }
    )
    cleanupFns.push(seqUnsub)

    set((state) => ({
      subscriptions: new Map(state.subscriptions).set(op.id, cleanupFns),
    }))
  },

  unsubscribe: (opId: string) => {
    const { subscriptions } = get()
    const cleanupFns = subscriptions.get(opId)
    if (cleanupFns) {
      cleanupFns.forEach((fn) => fn())
      const newSubscriptions = new Map(subscriptions)
      newSubscriptions.delete(opId)
      set({ subscriptions: newSubscriptions })
    }
  },
}))

// Helper to subscribe an operator to timeline changes
export function subscribeOpToTimeline(op: Operator<IOperator>): void {
  useTimelineDependencyStore.getState().subscribe(op)
}

// Helper to unsubscribe an operator from timeline changes
export function unsubscribeOpFromTimeline(opId: string): void {
  useTimelineDependencyStore.getState().unsubscribe(opId)
}
