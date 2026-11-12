// Opening the project the route names: the latest open wins, a failed open changes nothing,
// and a not-found dialog goes away once another open starts
import type { EditorDoc } from '@noodles.gl/planner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFileSystemStore } from '../noodles/filesystem-store'
import { load } from '../noodles/storage'
import { docStore } from './doc-store'
import { closeProject, openFile, openRoute, savedAs, useProjectOpen } from './project-open'

vi.mock('../noodles/storage', async importOriginal => ({
  ...(await importOriginal<typeof import('../noodles/storage')>()),
  load: vi.fn(),
}))

type LoadResult = Awaited<ReturnType<typeof load>>

const folder = (name: string) => ({ name }) as FileSystemDirectoryHandle
const docNamed = (name: string): EditorDoc => ({ version: 1, name, nodes: [], edges: [] })
const found = (name: string, projectData: unknown = docNamed(name)): LoadResult =>
  ({ success: true, data: { directoryHandle: folder(name), projectData } }) as LoadResult

// A load that finishes when the test says so
function deferLoad() {
  let finish!: (result: LoadResult) => void
  vi.mocked(load).mockImplementationOnce(() => new Promise(resolve => (finish = resolve)))
  return (result: LoadResult) => finish(result)
}

// Let the opens' awaits run
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

describe('openRoute', () => {
  beforeEach(() => {
    useFileSystemStore.getState().reset()
    useFileSystemStore.getState().setActiveStorageType('fileSystemAccess')
  })
  afterEach(() => {
    closeProject()
    vi.mocked(load).mockReset()
  })

  it('opens the project the route shows when two opens finish out of order', async () => {
    const finishA = deferLoad()
    const finishB = deferLoad()
    const a = openRoute('/projects', 'a')
    const b = openRoute('/projects', 'b')
    finishB(found('b'))
    await b
    finishA(found('a'))
    await a
    expect(docStore().get().doc.name).toBe('b')
    expect(useFileSystemStore.getState().currentProjectName).toBe('b')
    expect(useFileSystemStore.getState().currentDirectory?.name).toBe('b')
    expect(useProjectOpen.getState()).toEqual({ status: 'open', route: '/projects/b' })
  })

  it('leaves the open project and its folder as they were when a file fails to load', async () => {
    vi.mocked(load).mockResolvedValueOnce(found('a'))
    await openRoute('/projects', 'a')
    docStore().edit(d => ({ ...d, name: 'a, edited' }))

    // Not a project file: converting it throws
    vi.mocked(load).mockResolvedValueOnce(found('broken', null))
    await openRoute('/projects', 'broken')

    expect(useProjectOpen.getState()).toEqual({ status: 'failed', route: '/projects/broken' })
    expect(docStore().get().doc.name).toBe('a, edited')
    expect(docStore().get().dirty).toBe(true)
    const fs = useFileSystemStore.getState()
    expect(fs.currentProjectName).toBe('a')
    expect(fs.currentDirectory?.name).toBe('a')
    expect(fs.activeStorageType).toBe('fileSystemAccess')
    expect(fs.error?.message).toBe('Error opening project')
  })

  it('drops not found once another open starts', async () => {
    vi.mocked(load).mockResolvedValueOnce({
      success: false,
      error: { type: 'not-found', message: 'missing' },
    } as LoadResult)
    await openRoute('/projects', 'missing')
    expect(useProjectOpen.getState()).toMatchObject({ status: 'not-found', kind: 'project' })

    const finish = deferLoad()
    const next = openRoute('/projects', 'a')
    expect(useProjectOpen.getState()).toMatchObject({ status: 'opening', route: '/projects/a' })
    finish(found('a'))
    await next
    expect(useProjectOpen.getState()).toEqual({ status: 'open', route: '/projects/a' })
  })

  it('keeps a document a save moved to the route, instead of reading it back', async () => {
    docStore().load(docNamed('example'))
    docStore().edit(d => ({ ...d, name: 'flights' }))
    const { loadId } = docStore().get()
    savedAs(folder('flights'), 'flights')
    await openRoute('/projects', 'flights')
    expect(load).not.toHaveBeenCalled()
    expect(docStore().get().loadId).toBe(loadId)
    expect(docStore().canUndo()).toBe(true)
    expect(useFileSystemStore.getState()).toMatchObject({
      currentProjectName: 'flights',
      activeStorageType: 'fileSystemAccess',
    })
  })

  it('a file the not-found dialog found overtakes the open under way, and the route keeps it', async () => {
    const finish = deferLoad()
    const fromRoute = openRoute('/projects', 'a')
    const picked = openFile({ ...docNamed('a'), meta: { from: 'picked' } }, 'a', '/projects/a')
    await picked
    // The route change that follows the dialog
    await openRoute('/projects', 'a')
    finish(found('a', { ...docNamed('a'), meta: { from: 'disk' } }))
    await fromRoute
    await settle()
    expect(docStore().get().doc.meta).toEqual({ from: 'picked' })
    expect(load).toHaveBeenCalledTimes(1)
    expect(useProjectOpen.getState()).toEqual({ status: 'open', route: '/projects/a' })
  })
})
