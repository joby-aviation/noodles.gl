import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Router, Switch } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { getNoodles, type NoodlesProjectJSON } from './noodles'
import { useGraphStore } from './store'
import { memoryProjectStore } from './utils/memory-project-store'
import { NOODLES_VERSION } from './utils/migrate-schema'

const projectWithNode = (id: string): NoodlesProjectJSON =>
  ({
    version: NOODLES_VERSION,
    nodes: [{ id, type: 'NumberOp', position: { x: 0, y: 0 }, data: { inputs: {} } }],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    timeline: {},
  }) as unknown as NoodlesProjectJSON

const nodeIds = () => useGraphStore.getState().nodes.map(node => node.id)

describe('project loads driven by the URL', () => {
  // Project loads await storage and migrations, which fake timers would stall
  beforeEach(() => {
    vi.useRealTimers()
  })

  afterEach(() => {
    vi.useFakeTimers({ now: new Date('2025-02-01T00:00:00Z') })
    cleanup()
    useGraphStore.getState().clearGraph()
    memoryProjectStore.deleteProject('load-a')
    memoryProjectStore.deleteProject('load-b')
  })

  const renderEditorAt = (path: string) => {
    memoryProjectStore.setProjectJson('load-a', projectWithNode('/a-node'))
    memoryProjectStore.setProjectJson('load-b', projectWithNode('/b-node'))
    const location = memoryLocation({ path })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Router hook={location.hook}>
        <Switch>
          <Route path="/examples/:projectId">{children}</Route>
          <Route path="/projects/:projectId">{children}</Route>
        </Switch>
      </Router>
    )
    const { result } = renderHook(() => getNoodles(), { wrapper })
    return { location, result }
  }

  it('loads the project at each URL the browser navigates to', async () => {
    const { location } = renderEditorAt('/examples/load-a')
    await waitFor(() => expect(nodeIds()).toEqual(['/a-node']))

    // Back, Forward or a plain link changes the URL without going through loadProjectFile
    act(() => location.navigate('/examples/load-b'))
    await waitFor(() => expect(nodeIds()).toEqual(['/b-node']))

    act(() => location.navigate('/examples/load-a'))
    await waitFor(() => expect(nodeIds()).toEqual(['/a-node']))
  })
  it('skips the storage reload only for the route its own load navigated to', async () => {
    const { location, result } = renderEditorAt('/examples/load-a')
    await waitFor(() => expect(nodeIds()).toEqual(['/a-node']))
    const readProject = vi.spyOn(memoryProjectStore, 'getProjectJson')

    // New Project loads the starter itself, then navigates to /projects/new
    await act(() => result.current.onNewProject())
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(readProject).not.toHaveBeenCalledWith('new')

    act(() => location.navigate('/examples/load-a'))
    await waitFor(() => expect(nodeIds()).toEqual(['/a-node']))

    act(() => location.navigate('/projects/new'))
    await waitFor(() => expect(readProject).toHaveBeenCalledWith('new'))
  })
})
