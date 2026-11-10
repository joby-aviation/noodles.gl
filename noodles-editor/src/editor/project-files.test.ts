// A save writes the project's keys as Settings has them now, not as the file had them; it marks
// clean only what it wrote; and a save that moves the document to a new route keeps it open
import type { EditorDoc } from '@noodles.gl/planner'
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFileSystemStore } from '../noodles/filesystem-store'
import { getKeysStore } from '../noodles/keys-store'
import { load, save } from '../noodles/storage'
import { selectDirectory } from '../noodles/utils/filesystem'
import { docStore } from './doc-store'
import { projectJson, useProjectFiles } from './project-files'
import { closeProject, openRoute, type RoutePrefix, useProjectOpen } from './project-open'

vi.mock('../noodles/storage', async importOriginal => ({
  ...(await importOriginal<typeof import('../noodles/storage')>()),
  load: vi.fn(),
  save: vi.fn(),
  copyMemoryDataToDirectory: vi.fn(async () => {}),
}))
vi.mock('../noodles/utils/filesystem', async importOriginal => ({
  ...(await importOriginal<typeof import('../noodles/utils/filesystem')>()),
  selectDirectory: vi.fn(),
  requestPermission: vi.fn(async () => true),
  writeFileToDirectory: vi.fn(async () => {}),
}))
vi.mock('../noodles/utils/directory-handle-cache', () => ({
  directoryHandleCache: { cacheHandle: vi.fn(async () => {}), subscribe: () => () => {} },
}))

type SaveResult = Awaited<ReturnType<typeof save>>

const folder = (name: string) => ({ name }) as FileSystemDirectoryHandle
const docNamed = (name: string): EditorDoc => ({ version: 1, name, nodes: [], edges: [] })

// The route effect: a navigation opens the route it names
const navigate = vi.fn((to: string) => {
  const [, prefix, name] = to.split('/')
  void openRoute(`/${prefix}` as RoutePrefix, name)
})

function files(projectName: string, storageType: 'fileSystemAccess' | 'memory') {
  return renderHook(() =>
    useProjectFiles({
      projectName,
      storageType,
      navigate,
      onNewProject: async () => {},
      onImport: async () => {},
    })
  ).result.current
}

describe('projectJson', () => {
  afterEach(() => getKeysStore().setProjectKeys(undefined))

  it('saves the project keys as they are now, keeping the rest of meta', () => {
    docStore().load({
      version: 1,
      name: 'keys',
      nodes: [],
      edges: [],
      meta: { apiKeys: { mapbox: 'opened' }, startNode: 'n1' },
    })
    getKeysStore().setProjectKeys({ mapbox: 'edited' }, '/projects/keys')
    const saved = projectJson() as unknown as { meta: Record<string, unknown> }
    expect(saved.meta).toEqual({ apiKeys: { mapbox: 'edited' }, startNode: 'n1' })
  })

  it('leaves the keys out once the project has none', () => {
    docStore().load({ version: 1, name: 'keys', nodes: [], edges: [], meta: { apiKeys: {} } })
    getKeysStore().setProjectKeys(undefined)
    const saved = projectJson() as unknown as { meta: Record<string, unknown> }
    expect(saved.meta).not.toHaveProperty('apiKeys')
  })
})

describe('saving', () => {
  beforeEach(() => useFileSystemStore.getState().reset())
  afterEach(() => {
    cleanup()
    closeProject()
    getKeysStore().setProjectKeys(undefined)
    vi.mocked(load).mockReset()
    vi.mocked(save).mockReset()
    navigate.mockClear()
  })

  it('keeps an edit made while the save was writing unsaved', async () => {
    docStore().load(docNamed('a'))
    getKeysStore().setProjectKeys({ mapbox: 'opened' }, '/projects/a')
    getKeysStore().setProjectKey('mapbox', 'saved')
    docStore().edit(d => ({ ...d, name: 'first edit' }))
    let finish!: (result: SaveResult) => void
    vi.mocked(save).mockImplementationOnce(() => new Promise(resolve => (finish = resolve)))

    const saving = files('a', 'fileSystemAccess').onSaveProject()
    docStore().edit(d => ({ ...d, name: 'second edit' }))
    getKeysStore().setProjectKey('mapbox', 'edited while saving')
    finish({ success: true, data: { directoryHandle: folder('a') } } as SaveResult)
    await saving

    expect(docStore().get().dirty).toBe(true)
    expect(getKeysStore().savedProjectKeys).toEqual({ mapbox: 'saved' })
  })

  it('marks the document clean when nothing changed while it was written', async () => {
    docStore().load(docNamed('a'))
    docStore().edit(d => ({ ...d, name: 'edited' }))
    vi.mocked(save).mockResolvedValueOnce({
      success: true,
      data: { directoryHandle: folder('a') },
    } as SaveResult)
    await files('a', 'fileSystemAccess').onSaveProject()
    expect(docStore().get().dirty).toBe(false)
  })

  it("keeps an example's undo history and selection when its first save moves it to a folder", async () => {
    docStore().load(docNamed('nyc'))
    docStore().edit(d => ({ ...d, name: 'edited' }))
    docStore().set({ selection: ['n1'] })
    const { loadId } = docStore().get()
    vi.mocked(selectDirectory).mockResolvedValueOnce(folder('flights'))

    await files('nyc', 'memory').onSaveProject()

    expect(navigate).toHaveBeenCalledWith('/projects/flights', { replace: true })
    expect(load).not.toHaveBeenCalled()
    expect(docStore().get()).toMatchObject({ loadId, selection: ['n1'], dirty: false })
    expect(docStore().canUndo()).toBe(true)
    expect(useProjectOpen.getState()).toEqual({ status: 'open', route: '/projects/flights' })
    expect(useFileSystemStore.getState()).toMatchObject({
      currentProjectName: 'flights',
      activeStorageType: 'fileSystemAccess',
    })
  })
})
