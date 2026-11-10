import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { useFileSystemStore } from './filesystem-store'
import { getKeysStore } from './keys-store'
import { getNoodles, type NoodlesProjectJSON } from './noodles'
import { load, save } from './storage'
import { getOp, useGraphStore } from './store'
import { NOODLES_VERSION } from './utils/migrate-schema'
import {
  applyOperatorInputs,
  captureOperatorInputs,
  firePropertyMutation,
} from './utils/property-history'

vi.mock('./storage', { spy: true })

type SaveResult = Awaited<ReturnType<typeof save>>

const project = {
  version: NOODLES_VERSION,
  nodes: [{ id: '/num', type: 'NumberOp', position: { x: 0, y: 0 }, data: { inputs: {} } }],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  timeline: {},
} as unknown as NoodlesProjectJSON

const savedResult = {
  success: true,
  data: { directoryHandle: null, projectData: project },
} as unknown as SaveResult

// Each call to save waits until the test finishes it
const pendingSaves: Array<() => void> = []
const finishNextSave = () => act(() => pendingSaves.shift()?.())

const renderProject = async () => {
  const location = memoryLocation({ path: '/projects/saving' })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Router hook={location.hook}>
      <Route path="/projects/:projectId">{children}</Route>
    </Router>
  )
  const view = renderHook(() => getNoodles(), { wrapper })
  await waitFor(() => expect(useGraphStore.getState().nodes).toHaveLength(1))
  return view
}

// Editing a project key is one of the edits that marks the project unsaved
const edit = (value: string) => act(() => getKeysStore().setProjectKey('mapbox', value))

describe('saving a project', () => {
  beforeEach(() => {
    // Project loads and saves are async, which fake timers would stall
    vi.useRealTimers()
    vi.clearAllMocks()
    useFileSystemStore.setState({ activeStorageType: 'opfs' })
    vi.mocked(load).mockResolvedValue({
      success: true,
      data: { directoryHandle: null, projectData: project },
    } as unknown as Awaited<ReturnType<typeof load>>)
    vi.mocked(save).mockImplementation(
      () => new Promise(resolve => pendingSaves.push(() => resolve(savedResult)))
    )
  })

  afterEach(() => {
    cleanup()
    pendingSaves.length = 0
    useGraphStore.getState().clearGraph()
    useFileSystemStore.getState().reset()
    vi.useFakeTimers({ now: new Date('2025-02-01T00:00:00Z') })
  })

  it('keeps edits made while a save is writing marked unsaved', async () => {
    const { result } = await renderProject()
    edit('first')
    expect(result.current.hasUnsavedChanges).toBe(true)

    let saving: Promise<void> | undefined
    act(() => {
      saving = result.current.onSaveProject()
    })
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    edit('second')
    await finishNextSave()
    await act(() => saving)

    expect(result.current.hasUnsavedChanges).toBe(true)
  })

  it('marks the project saved when nothing changed during the save', async () => {
    const { result } = await renderProject()
    edit('first')

    let saving: Promise<void> | undefined
    act(() => {
      saving = result.current.onSaveProject()
    })
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    await finishNextSave()
    await act(() => saving)

    expect(result.current.hasUnsavedChanges).toBe(false)
  })

  it('starts a second save only after the first one finishes', async () => {
    const { result } = await renderProject()
    edit('first')

    let first: Promise<void> | undefined
    let second: Promise<void> | undefined
    act(() => {
      first = result.current.onSaveProject()
    })
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    edit('second')
    act(() => {
      second = result.current.onSaveProject()
    })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(save).toHaveBeenCalledTimes(1)

    await finishNextSave()
    await act(() => first)
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    // The queued save writes the project as it is when it starts, with the second edit
    expect(vi.mocked(save).mock.calls[1][2].apiKeys).toEqual({ mapbox: 'second' })
    await finishNextSave()
    await act(() => second)

    expect(result.current.hasUnsavedChanges).toBe(false)
  })

  describe('editing a field', () => {
    const val = () => getOp('/num')?.inputs.val as { setValue: (value: number) => void }

    // What a field component does when an edit ends: the undo history records it
    const editField = (value: number) =>
      act(() => {
        const before = captureOperatorInputs()
        val().setValue(value)
        firePropertyMutation('Edit val', before)
      })

    it('marks the project unsaved', async () => {
      const { result } = await renderProject()
      await waitFor(() => expect(getOp('/num')).toBeDefined())
      expect(result.current.hasUnsavedChanges).toBe(false)

      editField(5)

      expect(result.current.hasUnsavedChanges).toBe(true)
    })

    it('leaves the project saved when a value arrives without an edit', async () => {
      const { result } = await renderProject()
      await waitFor(() => expect(getOp('/num')).toBeDefined())

      // Upstream connections and keyframe playback set values this way
      act(() => val().setValue(5))

      expect(result.current.hasUnsavedChanges).toBe(false)
    })

    it('marks the project unsaved when undo restores a value after a save', async () => {
      const { result } = await renderProject()
      await waitFor(() => expect(getOp('/num')).toBeDefined())
      const before = captureOperatorInputs() as string
      editField(5)

      let saving: Promise<void> | undefined
      act(() => {
        saving = result.current.onSaveProject()
      })
      await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
      await finishNextSave()
      await act(() => saving)
      expect(result.current.hasUnsavedChanges).toBe(false)

      // Undo and redo put field values back this way
      act(() => applyOperatorInputs(before))

      expect(result.current.hasUnsavedChanges).toBe(true)
    })
  })
})
