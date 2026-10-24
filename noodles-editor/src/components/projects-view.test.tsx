import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CachedHandleEntry } from '../noodles/utils/directory-handle-cache'
import {
  fileExists,
  queryPermission,
  requestPermissionState,
  selectDirectory,
} from '../noodles/utils/filesystem'
import { analytics } from '../utils/analytics'
import { ProjectsView, reconnectProjectFolder, removeProjectFromList } from './projects-view'

const navigate = vi.fn()
vi.mock('wouter', () => ({ useLocation: () => ['/projects', navigate] }))
vi.mock('../utils/analytics', () => ({ analytics: { track: vi.fn() } }))
vi.mock('../noodles/utils/filesystem', () => ({
  checkFileSystemSupport: () => ({ fileSystemAccess: true, opfs: false }),
  fileExists: vi.fn(),
  getOPFSRoot: vi.fn(),
  queryPermission: vi.fn(),
  requestPermissionState: vi.fn(),
  selectDirectory: vi.fn(),
}))

// An in-memory stand-in for the IndexedDB list of remembered folders
const cache = vi.hoisted(() => {
  const entries = new Map<string, CachedHandleEntry>()
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of listeners) listener()
  }
  return {
    entries,
    getAllCachedHandles: async () => [...entries.values()],
    getCachedHandle: async (projectName: string) => entries.get(projectName) ?? null,
    cacheHandle: async (projectName: string, handle: FileSystemDirectoryHandle, path: string) => {
      entries.set(projectName, { projectName, handle, path, cachedAt: 1 })
      notify()
    },
    removeHandle: async (projectName: string) => {
      entries.delete(projectName)
      notify()
    },
    renameProject: async (oldName: string, newName: string, handle: FileSystemDirectoryHandle) => {
      entries.delete(oldName)
      entries.set(newName, { projectName: newName, handle, path: handle.name, cachedAt: 1 })
      notify()
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
})
vi.mock('../noodles/utils/directory-handle-cache', () => ({ directoryHandleCache: cache }))

function folder(name: string) {
  return { kind: 'directory', name } as FileSystemDirectoryHandle
}

function remember(name: string) {
  cache.entries.set(name, { projectName: name, handle: folder(name), path: name, cachedAt: 1 })
}

// Let IndexedDB-style promises and React updates settle
async function flush() {
  await act(async () => {
    await vi.runAllTimersAsync()
  })
}

async function renderView() {
  render(<ProjectsView onClose={vi.fn()} />)
  await flush()
}

async function chooseMenuItem(projectName: string, item: string) {
  act(() => {
    fireEvent.keyDown(screen.getByRole('button', { name: `Project actions for ${projectName}` }), {
      key: 'Enter',
    })
  })
  await flush()
  act(() => {
    screen.getByRole('menuitem', { name: item }).click()
  })
  await flush()
}

describe('ProjectsView project actions', () => {
  beforeEach(() => {
    cache.entries.clear()
    vi.mocked(analytics.track).mockReset()
    vi.mocked(queryPermission).mockReset().mockResolvedValue('granted')
    vi.mocked(requestPermissionState).mockReset()
    vi.mocked(selectDirectory).mockReset()
    vi.mocked(fileExists).mockReset().mockResolvedValue(true)
  })

  afterEach(() => {
    cleanup()
  })

  it('removes a project from the list without touching its folder', async () => {
    remember('alpha')
    remember('beta')
    await renderView()

    await chooseMenuItem('alpha', 'Remove from list')

    expect(screen.queryByRole('heading', { name: 'alpha' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'beta' })).toBeDefined()
    expect([...cache.entries.keys()]).toEqual(['beta'])
    expect(analytics.track).toHaveBeenCalledWith('project_removed_from_list', {
      storageType: 'fileSystemAccess',
      source: 'projects_tab',
    })
  })

  it('shows the folder name in the menu', async () => {
    remember('alpha')
    await renderView()

    act(() => {
      fireEvent.keyDown(screen.getByRole('button', { name: 'Project actions for alpha' }), {
        key: 'Enter',
      })
    })
    await flush()

    expect(screen.getByText('Folder: alpha')).toBeDefined()
    expect(screen.getByText('The folder and its files stay on your computer.')).toBeDefined()
  })

  it('marks a folder whose access lapsed and asks for it from the menu', async () => {
    remember('alpha')
    vi.mocked(queryPermission).mockResolvedValue('prompt')
    vi.mocked(requestPermissionState).mockResolvedValue('granted')
    await renderView()

    expect(screen.getByText('Needs access')).toBeDefined()
    // Still 'prompt' when the menu opens and when the click asks; granted after that
    vi.mocked(queryPermission)
      .mockResolvedValueOnce('prompt')
      .mockResolvedValueOnce('prompt')
      .mockResolvedValue('granted')
    await chooseMenuItem('alpha', 'Allow access')

    expect(requestPermissionState).toHaveBeenCalledWith(
      cache.entries.get('alpha')?.handle,
      'readwrite'
    )
    expect(screen.queryByText('Needs access')).toBeNull()
    expect(analytics.track).toHaveBeenCalledWith('project_permission_granted', {
      source: 'project_menu',
    })
  })

  it('only offers access when it is missing', async () => {
    remember('alpha')
    await renderView()

    act(() => {
      fireEvent.keyDown(screen.getByRole('button', { name: 'Project actions for alpha' }), {
        key: 'Enter',
      })
    })
    await flush()

    expect(screen.queryByRole('menuitem', { name: 'Allow access' })).toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Choose folder…' })).toBeDefined()
  })

  it('points the project at a folder chosen again, renamed on disk', async () => {
    remember('alpha')
    vi.mocked(selectDirectory).mockResolvedValue(folder('alpha-renamed'))
    await renderView()

    await chooseMenuItem('alpha', 'Choose folder…')

    expect(screen.queryByRole('heading', { name: 'alpha' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'alpha-renamed' })).toBeDefined()
    expect(analytics.track).toHaveBeenCalledWith('project_folder_reconnected', {
      source: 'projects_tab',
      folderNameChanged: true,
    })
  })

  it('refuses a chosen folder without a project file', async () => {
    remember('alpha')
    vi.mocked(selectDirectory).mockResolvedValue(folder('downloads'))
    vi.mocked(fileExists).mockResolvedValue(false)
    await renderView()

    await chooseMenuItem('alpha', 'Choose folder…')

    expect(screen.getByRole('alert').textContent).toBe(
      'The folder "downloads" has no noodles.json file. Choose the folder that holds the project.'
    )
    expect([...cache.entries.keys()]).toEqual(['alpha'])
    expect(analytics.track).not.toHaveBeenCalled()
  })

  it('reports a failed save after access is allowed', async () => {
    remember('alpha')
    vi.mocked(queryPermission).mockResolvedValue('prompt')
    vi.mocked(requestPermissionState).mockResolvedValue('granted')
    const cacheHandle = vi
      .spyOn(cache, 'cacheHandle')
      .mockRejectedValueOnce(new Error('QuotaExceededError'))
    await renderView()

    await chooseMenuItem('alpha', 'Allow access')

    expect(screen.getByRole('alert').textContent).toBe('Couldn\'t update access to "alpha".')
    cacheHandle.mockRestore()
  })

  it('shows the newest refresh when an older one finishes last', async () => {
    remember('alpha')
    remember('beta')
    await renderView()

    // The refresh after removing alpha waits on beta's access; the one after removing beta doesn't
    let finishOlder: (state: PermissionState) => void = () => {}
    vi.mocked(queryPermission).mockReturnValueOnce(
      new Promise(resolve => {
        finishOlder = resolve
      })
    )
    await act(() => removeProjectFromList('alpha', 'projects_tab'))
    await act(() => removeProjectFromList('beta', 'projects_tab'))
    await flush()
    finishOlder('granted')
    await flush()

    expect(screen.queryByRole('heading', { name: 'beta' })).toBeNull()
  })

  it('does nothing when the folder picker is cancelled', async () => {
    remember('alpha')
    vi.mocked(selectDirectory).mockRejectedValue(new DOMException('Cancelled', 'AbortError'))
    await renderView()

    await chooseMenuItem('alpha', 'Choose folder…')

    expect(screen.queryByRole('alert')).toBeNull()
    expect([...cache.entries.keys()]).toEqual(['alpha'])
  })
})

describe('project list actions', () => {
  beforeEach(() => {
    cache.entries.clear()
    vi.mocked(analytics.track).mockReset()
    vi.mocked(fileExists).mockReset().mockResolvedValue(true)
  })

  it('never sends project or folder names', async () => {
    remember('secret-project')
    await removeProjectFromList('secret-project', 'recent_projects')
    remember('secret-project')
    await reconnectProjectFolder('secret-project', folder('secret-folder'), 'recent_projects')

    const sent = JSON.stringify(vi.mocked(analytics.track).mock.calls)
    expect(sent).not.toContain('secret')
  })

  it('refuses a folder named like another saved project', async () => {
    remember('alpha')
    remember('beta')
    const message = await reconnectProjectFolder('alpha', folder('beta'), 'recent_projects')

    expect(message).toBe(
      'Another saved project is already named "beta". Remove it from the list first, or choose a different folder.'
    )
    expect(cache.entries.get('alpha')?.handle.name).toBe('alpha')
    expect(cache.entries.get('beta')?.handle).not.toBe(folder('beta'))
    expect(analytics.track).not.toHaveBeenCalled()
  })

  it('keeps the project name when the chosen folder has the same name', async () => {
    remember('alpha')
    await reconnectProjectFolder('alpha', folder('alpha'), 'recent_projects')

    expect([...cache.entries.keys()]).toEqual(['alpha'])
    expect(analytics.track).toHaveBeenCalledWith('project_folder_reconnected', {
      source: 'recent_projects',
      folderNameChanged: false,
    })
  })
})
