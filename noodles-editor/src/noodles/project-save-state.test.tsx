import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { useFileSystemStore } from './filesystem-store'
import { getKeysStore } from './keys-store'
import { getNoodles } from './noodles'
import { copyMemoryDataToDirectory, load, save } from './storage'
import { useGraphStore } from './store'
import { directoryHandleCache } from './utils/directory-handle-cache'
import { requestPermission, selectDirectory, writeFileToDirectory } from './utils/filesystem'
import { saveGitSettings } from './utils/git-settings'
import { NOODLES_VERSION } from './utils/migrate-schema'
import { writeOutputCache } from './utils/output-cache'
import type { NoodlesProjectJSON } from './utils/serialization'

vi.mock('./storage', { spy: true })
vi.mock('./utils/filesystem', { spy: true })
vi.mock('./utils/output-cache', { spy: true })

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

const renderProject = async (path = '/projects/saving') => {
  const location = memoryLocation({ path })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Router hook={location.hook}>
      <Route path="/projects/:projectId">{children}</Route>
    </Router>
  )
  const view = renderHook(() => getNoodles(), { wrapper })
  await waitFor(() => expect(useGraphStore.getState().nodes.length).toBeGreaterThan(0))
  return { ...view, location }
}

const wait = (ms: number) => act(() => new Promise(resolve => setTimeout(resolve, ms)))

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
    localStorage.removeItem('noodles-git-settings:saving')
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

  it('drops a queued save once another project opens', async () => {
    const { result } = await renderProject()
    edit('first')

    let first: Promise<void> | undefined
    act(() => {
      first = result.current.onSaveProject()
      void result.current.onSaveProject()
    })
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    await act(() => result.current.onNewProject())
    await finishNextSave()
    await act(() => first)
    await wait(50)

    // Saving the new draft would ask for a folder
    expect(selectDirectory).not.toHaveBeenCalled()
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('keeps the graph and edits made while a draft is saved to a folder', async () => {
    const { result } = await renderProject()
    await act(() => result.current.onNewProject())
    await waitFor(() => expect(useFileSystemStore.getState().activeStorageType).toBe('memory'))
    vi.mocked(selectDirectory).mockResolvedValue({ name: 'folder' } as FileSystemDirectoryHandle)
    vi.mocked(requestPermission).mockResolvedValue(true)
    vi.mocked(writeFileToDirectory).mockImplementation(
      () => new Promise(resolve => pendingSaves.push(() => resolve()))
    )
    vi.mocked(writeOutputCache).mockResolvedValue(undefined)
    vi.mocked(copyMemoryDataToDirectory).mockResolvedValue(undefined)
    vi.spyOn(directoryHandleCache, 'cacheHandle').mockResolvedValue(undefined)
    edit('first')

    let saving: Promise<void> | undefined
    act(() => {
      saving = result.current.onSaveProject()
    })
    await waitFor(() => expect(writeFileToDirectory).toHaveBeenCalledTimes(1))
    edit('second')
    await finishNextSave()
    await act(() => saving)
    await wait(50)

    // The folder now holds what was written; reading it back would drop the second edit
    expect(load).not.toHaveBeenCalledWith('fileSystemAccess', 'folder')
    expect(result.current.hasUnsavedChanges).toBe(true)
  })

  describe('autosave', () => {
    beforeEach(() => {
      saveGitSettings({ enabled: true, autoCommit: true, autoCommitDelay: 200 }, 'saving')
    })

    it('waits for the delay after the last edit', async () => {
      await renderProject()
      edit('first')
      await wait(120)
      edit('second')
      await wait(120)
      edit('third')
      await wait(120)
      expect(save).not.toHaveBeenCalled()

      await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
      expect(vi.mocked(save).mock.calls[0][2].apiKeys).toEqual({ mapbox: 'third' })
    })

    it('saves again for an edit made while it was writing', async () => {
      const { result } = await renderProject()
      edit('first')
      await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
      edit('second')
      await finishNextSave()

      await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
      expect(vi.mocked(save).mock.calls[1][2].apiKeys).toEqual({ mapbox: 'second' })
      await finishNextSave()
      await waitFor(() => expect(result.current.hasUnsavedChanges).toBe(false))
    })
  })
})
