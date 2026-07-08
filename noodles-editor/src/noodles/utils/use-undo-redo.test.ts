// Integration tests for useUndoRedo — focuses on timeline track cleanup during node deletion
import { act, renderHook } from '@testing-library/react'
import { ReactFlowProvider, useStoreApi } from '@xyflow/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTimelineStore } from '../../timeline/timeline-store'
import { useUndoRedo } from './use-undo-redo'

// Wrapper providing the ReactFlow context required by useUndoRedo
const wrapper = ({ children }: { children: React.ReactNode }) =>
  createElement(ReactFlowProvider, null, children)

// Helper hook that exposes both useUndoRedo and the RF store API
function useTestHook() {
  const undoRedo = useUndoRedo()
  const storeApi = useStoreApi()
  return { undoRedo, storeApi }
}

// Renders the hook and injects a real onNodesChange into the RF store so the
// useUndoRedo interceptor has something to wrap.
async function setupHook() {
  const { result } = renderHook(() => useTestHook(), { wrapper })

  // Inject a minimal onNodesChange so the interceptor effect fires
  await act(async () => {
    result.current.storeApi.setState({ onNodesChange: () => {} })
  })

  // Get the now-intercepted onNodesChange
  const onNodesChange = result.current.storeApi.getState().onNodesChange
  return { result, onNodesChange }
}

describe('useUndoRedo — timeline track deletion', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useTimelineStore.getState().reset()
  })

  afterEach(() => {
    vi.useRealTimers()
    useTimelineStore.getState().reset()
  })

  it('deletes timeline tracks for removed nodes when onNodesChange fires', async () => {
    const { onNodesChange } = await setupHook()

    act(() => {
      useTimelineStore.getState().getOrCreateTrack('my-op / par / value', 0)
    })
    expect(useTimelineStore.getState().getTrack('my-op / par / value')).toBeDefined()

    // Trigger a node removal via the intercepted onNodesChange
    act(() => {
      onNodesChange([{ type: 'remove', id: '/my-op' }])
    })

    expect(useTimelineStore.getState().getTrack('my-op / par / value')).toBeUndefined()
  })

  it('captures track deletion in the undo/redo history entry', async () => {
    const { result, onNodesChange } = await setupHook()

    // A track must have keyframes to appear in serialized timeline state
    act(() => {
      const store = useTimelineStore.getState()
      store.getOrCreateTrack('my-op / par / value', 0)
      store.addKeyframe('my-op / par / value', { position: 1, value: 42, interpolation: 'bezier' })
    })

    // Trigger removal and flush the setTimeout so the history entry is recorded
    act(() => {
      onNodesChange([{ type: 'remove', id: '/my-op' }])
    })
    await act(async () => {
      vi.runAllTimers()
    })

    expect(result.current.undoRedo.canUndo()).toBe(true)
    const entry = result.current.undoRedo.history[0]
    expect(entry).toBeDefined()
    // timelineStateBefore should reference my-op, timelineStateAfter should not
    const before = JSON.stringify(JSON.parse(entry.timelineStateBefore ?? '{}'))
    const after = JSON.stringify(JSON.parse(entry.timelineStateAfter ?? '{}'))
    expect(before).toContain('my-op')
    expect(after).not.toContain('my-op')
  })

  it('restores tracks on undo', async () => {
    const { result, onNodesChange } = await setupHook()

    // A track must have keyframes to be serialized and thus restorable via undo
    act(() => {
      const store = useTimelineStore.getState()
      store.getOrCreateTrack('my-op / par / value', 0)
      store.addKeyframe('my-op / par / value', { position: 1, value: 42, interpolation: 'bezier' })
    })

    act(() => {
      onNodesChange([{ type: 'remove', id: '/my-op' }])
    })
    await act(async () => {
      vi.runAllTimers()
    })

    expect(useTimelineStore.getState().getTrack('my-op / par / value')).toBeUndefined()

    act(() => {
      result.current.undoRedo.undo()
    })

    expect(useTimelineStore.getState().getTrack('my-op / par / value')).toBeDefined()
  })

  it('does not delete tracks for other operators', async () => {
    const { onNodesChange } = await setupHook()

    act(() => {
      useTimelineStore.getState().getOrCreateTrack('my-op / par / value', 0)
      useTimelineStore.getState().getOrCreateTrack('other-op / par / value', 0)
    })

    act(() => {
      onNodesChange([{ type: 'remove', id: '/my-op' }])
    })

    expect(useTimelineStore.getState().getTrack('my-op / par / value')).toBeUndefined()
    expect(useTimelineStore.getState().getTrack('other-op / par / value')).toBeDefined()
  })

  it('deletes tracks for all removed nodes in a batch removal', async () => {
    const { onNodesChange } = await setupHook()

    act(() => {
      useTimelineStore.getState().getOrCreateTrack('op-a / par / value', 0)
      useTimelineStore.getState().getOrCreateTrack('op-b / par / value', 0)
    })

    act(() => {
      onNodesChange([
        { type: 'remove', id: '/op-a' },
        { type: 'remove', id: '/op-b' },
      ])
    })

    expect(useTimelineStore.getState().getTrack('op-a / par / value')).toBeUndefined()
    expect(useTimelineStore.getState().getTrack('op-b / par / value')).toBeUndefined()
  })
})
