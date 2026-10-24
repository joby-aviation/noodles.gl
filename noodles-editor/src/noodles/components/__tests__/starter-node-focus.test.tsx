// Tests that StarterNodeFocus pans to the starter node once per project load
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '../../store'
import { StarterNodeFocus } from '../starter-node-focus'

const setViewport = vi.fn()
// Far outside a 1000x500 pane at zoom 1, so every check pans
const flush = () => act(() => vi.advanceTimersByTimeAsync(20))

const offscreenNode = {
  measured: { width: 100, height: 50 },
  internals: { positionAbsolute: { x: 5000, y: 5000 } },
}

vi.mock('@xyflow/react', () => ({
  useNodesInitialized: () => true,
  useReactFlow: () => ({
    getInternalNode: () => offscreenNode,
    getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    setViewport,
  }),
  useStore: (
    selector: (state: {
      width: number
      height: number
      nodeLookup: Map<string, typeof offscreenNode>
    }) => unknown
  ) =>
    selector({
      width: 1000,
      height: 500,
      nodeLookup: new Map([['/scatterplot-layer', offscreenNode]]),
    }),
}))

describe('StarterNodeFocus', () => {
  beforeEach(() => {
    // setupTests turns on fake timers; route animation frames through them
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0))
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
    setViewport.mockClear()
    useUIStore.getState().setStarterHintNodeId('/scatterplot-layer')
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    useUIStore.getState().setStarterHintNodeId(null)
  })

  it('pans once for a load, even across re-renders', async () => {
    const { rerender } = render(<StarterNodeFocus loadId={1} />)
    await flush()
    expect(setViewport).toHaveBeenCalledTimes(1)
    rerender(<StarterNodeFocus loadId={1} />)
    await flush()
    expect(setViewport).toHaveBeenCalledTimes(1)
  })

  it('pans again when the next example starts on the same node id', async () => {
    const { rerender } = render(<StarterNodeFocus loadId={1} />)
    await flush()
    expect(setViewport).toHaveBeenCalledTimes(1)
    rerender(<StarterNodeFocus loadId={2} />)
    await flush()
    expect(setViewport).toHaveBeenCalledTimes(2)
  })
})
