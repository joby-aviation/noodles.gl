// Tests that ProjectLoadView fits the graph on a fresh load and then pans to the starter
// node, and that MapPickFocus pans to and pulses a node picked on the map
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '../../../editor/ui-store'
import {
  LOAD_FIT_VIEW_OPTIONS,
  MAP_PICK_PULSE_MS,
  MapPickFocus,
  ProjectLoadView,
} from '../starter-node-focus'

const setViewport = vi.fn()
const fitView = vi.fn(() => Promise.resolve(true))
let measured = true
// Far outside a 1000x500 pane at zoom 1, so every check pans
const flush = () => act(() => vi.advanceTimersByTimeAsync(20))

const offscreenNode = {
  measured: { width: 100, height: 50 },
  internals: { positionAbsolute: { x: 5000, y: 5000 } },
}

vi.mock('@xyflow/react', () => ({
  useNodesInitialized: () => measured,
  useStoreApi: () => ({
    getState: () => ({
      nodeLookup: new Map([['/scatterplot-layer', offscreenNode]]),
      nodesInitialized: measured,
    }),
  }),
  useReactFlow: () => ({
    fitView,
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
      nodeLookup: new Map([
        ['/scatterplot-layer', offscreenNode],
        ['/group/arcs', offscreenNode],
      ]),
    }),
}))

describe('ProjectLoadView', () => {
  // The fit takes a frame, and the starter pan runs a frame after it
  const settle = async () => {
    await flush()
    await flush()
  }

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
    await settle()
    expect(fitView).toHaveBeenCalledWith(LOAD_FIT_VIEW_OPTIONS)
    expect(setViewport).toHaveBeenCalledTimes(1)
    expect(fitView.mock.invocationCallOrder[0]).toBeLessThan(
      setViewport.mock.invocationCallOrder[0]
    )
  })

  it('waits until every node is measured before fitting', async () => {
    measured = false
    const { rerender } = render(<ProjectLoadView loadId={1} fitView />)
    await settle()
    expect(fitView).not.toHaveBeenCalled()
    measured = true
    rerender(<ProjectLoadView loadId={1} fitView />)
    await settle()
    expect(fitView).toHaveBeenCalledTimes(1)
  })

  it('keeps the view without fitView, still showing the starter node', async () => {
    render(<ProjectLoadView loadId={1} fitView={false} />)
    await settle()
    expect(fitView).not.toHaveBeenCalled()
    expect(setViewport).toHaveBeenCalledTimes(1)
  })

  it('runs once for a load, even across re-renders', async () => {
    const { rerender } = render(<ProjectLoadView loadId={1} fitView />)
    await settle()
    rerender(<ProjectLoadView loadId={1} fitView />)
    await settle()
    expect(fitView).toHaveBeenCalledTimes(1)
    expect(setViewport).toHaveBeenCalledTimes(1)
  })

  it('runs again when the next example starts on the same node id', async () => {
    const { rerender } = render(<ProjectLoadView loadId={1} fitView />)
    await settle()
    rerender(<ProjectLoadView loadId={2} fitView />)
    await settle()
    expect(fitView).toHaveBeenCalledTimes(2)
    expect(setViewport).toHaveBeenCalledTimes(2)
  })
})

describe('MapPickFocus', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0))
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
    setViewport.mockClear()
    useUIStore.setState({ mapPickFocus: null, pulsingNodeId: null })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    useUIStore.setState({ mapPickFocus: null, pulsingNodeId: null })
  })

  const pulsing = () => useUIStore.getState().pulsingNodeId

  it('pans to a picked node and pulses it for a second', async () => {
    render(<MapPickFocus />)
    await flush()
    expect(setViewport).not.toHaveBeenCalled()

    act(() => useUIStore.getState().focusNodeFromMap('/group/arcs'))
    await flush()
    expect(setViewport).toHaveBeenCalledTimes(1)
    expect(pulsing()).toBe('/group/arcs')

    await act(() => vi.advanceTimersByTimeAsync(MAP_PICK_PULSE_MS))
    expect(pulsing()).toBeNull()
  })

  it('pulses again when the same node is picked twice', async () => {
    render(<MapPickFocus />)
    act(() => useUIStore.getState().focusNodeFromMap('/group/arcs'))
    await flush()
    await act(() => vi.advanceTimersByTimeAsync(MAP_PICK_PULSE_MS))
    expect(pulsing()).toBeNull()

    act(() => useUIStore.getState().focusNodeFromMap('/group/arcs'))
    await flush()
    expect(pulsing()).toBe('/group/arcs')
    expect(setViewport).toHaveBeenCalledTimes(2)
  })
})
