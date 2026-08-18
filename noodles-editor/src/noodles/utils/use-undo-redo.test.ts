// Integration tests for useUndoRedo — focuses on timeline track cleanup during node deletion
// and verifying that graphRef captures the full graph state (not just displayed scope)
import { act, renderHook } from '@testing-library/react'
import type { Edge as ReactFlowEdge, Node as ReactFlowNode } from '@xyflow/react'
import { ReactFlowProvider, useStoreApi } from '@xyflow/react'
import { createElement, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTimelineStore } from '../../timeline/timeline-store'
import type { GraphRef } from '../types'
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

// Helper hook with graphRef — simulates the full graph including out-of-scope children
function useTestHookWithGraphRef(fullNodes: ReactFlowNode[], fullEdges: ReactFlowEdge[]) {
  const graphRef = useRef({ nodes: fullNodes, edges: fullEdges }) as GraphRef
  graphRef.current = { nodes: fullNodes, edges: fullEdges }
  const undoRedo = useUndoRedo({ graphRef })
  const storeApi = useStoreApi()
  return { undoRedo, storeApi, graphRef }
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

describe('useUndoRedo — graphRef captures full state across scopes', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function makeNode(id: string, type = 'NumberOp'): ReactFlowNode {
    return { id, type, position: { x: 0, y: 0 }, data: {} }
  }

  // Setup: graphRef has ALL nodes (container + children), but ReactFlow's store
  // only has the root-level nodes (simulating the displayedNodes filter)
  async function setupWithGraphRef() {
    const fullNodes: ReactFlowNode[] = [
      makeNode('/source'),
      makeNode('/container', 'ContainerOp'),
      makeNode('/container/child1'),
      makeNode('/container/child2'),
      makeNode('/sink'),
    ]
    const fullEdges: ReactFlowEdge[] = []

    // Only root-level nodes are in ReactFlow's store (simulating displayedNodes)
    const displayedNodes: ReactFlowNode[] = [
      makeNode('/source'),
      makeNode('/container', 'ContainerOp'),
      makeNode('/sink'),
    ]

    const { result } = renderHook(() => useTestHookWithGraphRef(fullNodes, fullEdges), { wrapper })

    // Inject displayedNodes into ReactFlow's store (what RF actually sees)
    await act(async () => {
      result.current.storeApi.setState({
        nodes: displayedNodes,
        edges: [],
        onNodesChange: () => {},
      })
    })

    const onNodesChange = result.current.storeApi.getState().onNodesChange
    return { result, onNodesChange, fullNodes, displayedNodes }
  }

  it('history entry nodesBefore includes out-of-scope children via graphRef', async () => {
    const { result, onNodesChange } = await setupWithGraphRef()

    // Trigger a node removal (user deletes /container from root scope)
    act(() => {
      onNodesChange!([{ type: 'remove', id: '/container' }])
    })
    await act(async () => {
      vi.runAllTimers()
    })

    const entry = result.current.undoRedo.history[0]
    expect(entry).toBeDefined()

    // nodesBefore should have ALL 5 nodes (from graphRef), not just the 3 displayed
    const beforeIds = entry.nodesBefore.map((n: ReactFlowNode) => n.id).sort()
    expect(beforeIds).toContain('/container/child1')
    expect(beforeIds).toContain('/container/child2')
    expect(beforeIds.length).toBe(5)
  })

  it('without graphRef, history entry only captures displayed nodes', async () => {
    // Standard setup WITHOUT graphRef (old behavior)
    const { result } = renderHook(() => useTestHook(), { wrapper })

    const displayedNodes: ReactFlowNode[] = [
      makeNode('/source'),
      makeNode('/container', 'ContainerOp'),
      makeNode('/sink'),
    ]

    await act(async () => {
      result.current.storeApi.setState({
        nodes: displayedNodes,
        edges: [],
        onNodesChange: () => {},
      })
    })

    const onNodesChange = result.current.storeApi.getState().onNodesChange

    act(() => {
      onNodesChange!([{ type: 'remove', id: '/container' }])
    })
    await act(async () => {
      vi.runAllTimers()
    })

    const entry = result.current.undoRedo.history[0]
    expect(entry).toBeDefined()

    // Without graphRef, only displayed nodes are captured (children missing)
    const beforeIds = entry.nodesBefore.map((n: ReactFlowNode) => n.id).sort()
    expect(beforeIds).not.toContain('/container/child1')
    expect(beforeIds.length).toBe(3)
  })

  it('undo with graphRef can compute correct add-back set including children', async () => {
    const fullNodes: ReactFlowNode[] = [
      makeNode('/source'),
      makeNode('/container', 'ContainerOp'),
      makeNode('/container/child1'),
      makeNode('/container/child2'),
      makeNode('/sink'),
    ]
    const fullEdges: ReactFlowEdge[] = []

    const { result } = renderHook(() => useTestHookWithGraphRef(fullNodes, fullEdges), { wrapper })

    await act(async () => {
      result.current.storeApi.setState({
        nodes: [makeNode('/source'), makeNode('/container', 'ContainerOp'), makeNode('/sink')],
        edges: [],
        onNodesChange: () => {},
      })
    })

    const onNodesChange = result.current.storeApi.getState().onNodesChange

    // Trigger removal — this captures nodesBefore from graphRef (full state)
    act(() => {
      onNodesChange!([{ type: 'remove', id: '/container' }])
    })

    // Simulate what handleNodesDeleted does: mutate the full state to remove
    // container + children BEFORE the setTimeout fires (mirrors production timing)
    fullNodes.splice(1, 3) // remove /container, /container/child1, /container/child2

    await act(async () => {
      vi.runAllTimers()
    })

    expect(result.current.undoRedo.canUndo()).toBe(true)

    const entry = result.current.undoRedo.history[0]

    // nodesBefore has all 5 nodes, nodesAfter has only 2 (after cascade delete)
    const beforeIds = new Set(entry.nodesBefore.map((n: ReactFlowNode) => n.id))
    const afterIds = new Set(entry.nodesAfter.map((n: ReactFlowNode) => n.id))

    // The diff (what undo would add back) includes the container AND its children
    const wouldRestore = [...beforeIds].filter(id => !afterIds.has(id))
    expect(wouldRestore).toContain('/container')
    expect(wouldRestore).toContain('/container/child1')
    expect(wouldRestore).toContain('/container/child2')
  })
})
