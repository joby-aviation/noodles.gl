// Reopening a local-folder project after a browser restart. Chrome remembers the folder
// handle in IndexedDB but resets its permission to 'prompt', and requestPermission throws
// without a user gesture, so the route load must not ask and must not forget the folder.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareProjectOpen, requestProjectAccess } from '../components/projects-view'
import { analytics } from '../utils/analytics'
import { useFileSystemStore } from './filesystem-store'
import { load } from './storage'
import { type CachedHandleEntry, directoryHandleCache } from './utils/directory-handle-cache'
import { requestPermissionState } from './utils/filesystem'

vi.mock('../utils/analytics', () => ({ analytics: { track: vi.fn() } }))

function createHandle(permission: PermissionState): FileSystemDirectoryHandle {
  const projectJson = JSON.stringify({ version: 1, nodes: [], edges: [] })
  return {
    kind: 'directory',
    name: 'project_1',
    queryPermission: vi.fn().mockResolvedValue(permission),
    // Without transient user activation Chrome rejects with a SecurityError
    requestPermission: vi
      .fn()
      .mockRejectedValue(
        new DOMException('User activation is required to request permissions.', 'SecurityError')
      ),
    getFileHandle: vi.fn().mockResolvedValue({
      kind: 'file',
      name: 'noodles.json',
      getFile: vi.fn().mockResolvedValue({ text: () => Promise.resolve(projectJson) }),
    }),
    getDirectoryHandle: vi.fn().mockRejectedValue(new DOMException('Not found', 'NotFoundError')),
  } as unknown as FileSystemDirectoryHandle
}

describe('load from a remembered local folder', () => {
  let entry: CachedHandleEntry | null

  beforeEach(() => {
    vi.restoreAllMocks()
    entry = null
    vi.spyOn(directoryHandleCache, 'getCachedHandle').mockImplementation(async () => entry)
    vi.spyOn(directoryHandleCache, 'cacheHandle').mockResolvedValue()
    vi.spyOn(directoryHandleCache, 'removeHandle').mockImplementation(async () => {
      entry = null
    })
  })

  function remember(handle: FileSystemDirectoryHandle) {
    entry = { projectName: 'project_1', handle, path: 'project_1', cachedAt: 1 }
  }

  it('asks for a click when the permission is back to prompt, and keeps the folder', async () => {
    const handle = createHandle('prompt')
    remember(handle)

    const result = await load('fileSystemAccess', 'project_1')

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.type).toBe('permission-prompt')
    expect(result.error.directoryHandle).toBe(handle)
    // Asking here would throw without a user gesture
    expect(handle.requestPermission).not.toHaveBeenCalled()
    // The project stays in Recent projects
    expect(directoryHandleCache.removeHandle).not.toHaveBeenCalled()
    expect(entry).not.toBeNull()
  })

  it('reports a denied permission without forgetting the folder', async () => {
    const handle = createHandle('denied')
    remember(handle)

    const result = await load('fileSystemAccess', 'project_1')

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.type).toBe('permission-denied')
    expect(result.error.directoryHandle).toBe(handle)
    expect(entry).not.toBeNull()
  })

  it('reports not-found when no folder is remembered', async () => {
    const result = await load('fileSystemAccess', 'project_1')

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.type).toBe('not-found')
  })

  it('loads when the permission is still granted', async () => {
    const handle = createHandle('granted')
    remember(handle)

    const result = await load('fileSystemAccess', 'project_1')

    expect(result.success).toBe(true)
    expect(handle.requestPermission).not.toHaveBeenCalled()
  })
})

describe('requestPermissionState', () => {
  it('reports prompt instead of throwing when there is no user gesture', async () => {
    const handle = createHandle('prompt')
    expect(await requestPermissionState(handle)).toBe('prompt')
  })

  it('does not ask when access is already granted', async () => {
    const handle = createHandle('granted')
    expect(await requestPermissionState(handle)).toBe('granted')
    expect(handle.requestPermission).not.toHaveBeenCalled()
  })
})

describe('requestProjectAccess from the projects list', () => {
  beforeEach(() => {
    vi.mocked(analytics.track).mockReset()
  })

  it('asks during the click when the permission is back to prompt', async () => {
    const handle = createHandle('prompt')
    vi.mocked(handle.requestPermission).mockResolvedValue('granted')

    await requestProjectAccess(handle)

    expect(handle.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' })
    expect(analytics.track).toHaveBeenCalledWith('project_permission_granted', {
      source: 'project_list',
    })
  })

  it('tracks a dismissed prompt without the folder name', async () => {
    const handle = createHandle('prompt')
    vi.mocked(handle.requestPermission).mockResolvedValue('prompt')

    await requestProjectAccess(handle)

    expect(analytics.track).toHaveBeenCalledWith('project_permission_denied', {
      source: 'project_list',
      state: 'prompt',
    })
  })

  it('loads from where the project lives, even after an example set memory storage', async () => {
    useFileSystemStore.getState().setActiveStorageType('memory')

    await prepareProjectOpen({ storageType: 'fileSystemAccess', handle: createHandle('granted') })
    expect(useFileSystemStore.getState().activeStorageType).toBe('fileSystemAccess')

    await prepareProjectOpen({ storageType: 'opfs' })
    expect(useFileSystemStore.getState().activeStorageType).toBe('opfs')
  })

  it('does nothing when access is granted or blocked', async () => {
    for (const permission of ['granted', 'denied'] as const) {
      const handle = createHandle(permission)
      await requestProjectAccess(handle)
      expect(handle.requestPermission).not.toHaveBeenCalled()
    }
    await requestProjectAccess(undefined)
    expect(analytics.track).not.toHaveBeenCalled()
  })
})
