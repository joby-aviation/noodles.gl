// Tests that ProjectLoadView fits the graph on a fresh load and pans to the starter node
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '../../store'
import { LOAD_FIT_VIEW_OPTIONS, ProjectLoadView } from '../project-load-view'

const setViewport = vi.fn()
const fitView = vi.fn(() => Promise.resolve(true))
let measured = true
const flush = () => act(() => vi.advanceTimersByTimeAsync(20))

// Far outside a 1000x500 pane at zoom 1, so every check pans
const offscreenNode = {
  measured: { width: 100, height: 50 },
  internals: { positionAbsolute: { x: 5000, y: 5000 } },
}

vi.mock('@xyflow/react', async importOriginal => ({
  ...(await importOriginal<typeof import('@xyflow/react')>()),
  useNodesInitialized: () => measured,
  useStoreApi: () => ({
    getState: () => ({
      nodeLookup: new Map([['/scatterplot-layer', offscreenNode]]),
      nodesInitialized: measured,
      width: 1000,
      height: 500,
    }),
  }),
  useReactFlow: () => ({
    fitView,
    getInternalNode: () => offscreenNode,
    getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    setViewport,
  }),
}))

describe('ProjectLoadView', () => {
  beforeEach(() => {
    // setupTests turns on fake timers; route animation frames through them
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0))
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
    setViewport.mockClear()
    fitView.mockClear()
    measured = true
    useUIStore.getState().setStarterHintNodeId('/scatterplot-layer')
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    useUIStore.getState().setStarterHintNodeId(null)
  })

  it('fits the whole graph on a fresh load, then pans to the starter node', async () => {
    render(<ProjectLoadView loadId={1} fitView />)
    await flush()
    expect(fitView).toHaveBeenCalledWith(LOAD_FIT_VIEW_OPTIONS)
    expect(setViewport).toHaveBeenCalledTimes(1)
  })

  it('waits until every node is measured before fitting', async () => {
    measured = false
    const { rerender } = render(<ProjectLoadView loadId={1} fitView />)
    await flush()
    expect(fitView).not.toHaveBeenCalled()
    measured = true
    rerender(<ProjectLoadView loadId={1} fitView />)
    await flush()
    expect(fitView).toHaveBeenCalledTimes(1)
  })

  it('keeps the view on an undo/redo restore', async () => {
    useUIStore.getState().setStarterHintNodeId(null)
    render(<ProjectLoadView loadId={1} fitView={false} />)
    await flush()
    expect(fitView).not.toHaveBeenCalled()
    expect(setViewport).not.toHaveBeenCalled()
  })

  it('runs once for a load, even across re-renders', async () => {
    const { rerender } = render(<ProjectLoadView loadId={1} fitView />)
    await flush()
    rerender(<ProjectLoadView loadId={1} fitView />)
    await flush()
    expect(fitView).toHaveBeenCalledTimes(1)
    expect(setViewport).toHaveBeenCalledTimes(1)
  })

  it('runs again when the next example starts on the same node id', async () => {
    const { rerender } = render(<ProjectLoadView loadId={1} fitView />)
    await flush()
    rerender(<ProjectLoadView loadId={2} fitView />)
    await flush()
    expect(fitView).toHaveBeenCalledTimes(2)
    expect(setViewport).toHaveBeenCalledTimes(2)
  })
})
