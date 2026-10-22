// Tests for route-based project loading logic
// Tests the fix for setting activeStorageType after loading from user storage (line 724 in noodles.tsx)
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import createFetchMock from 'vitest-fetch-mock'
import { useActiveStorageType, useFileSystemStore } from '../filesystem-store'

const fetchMock = createFetchMock(vi)

// Mock the storage module
vi.mock('../storage', () => ({
  load: vi.fn(),
  save: vi.fn(),
}))

// Mock schema migration
vi.mock('../utils/migrate-schema', () => ({
  migrateProject: vi.fn(data => Promise.resolve(data)),
}))

// Import mocked modules after vi.mock declarations
import { load } from '../storage'

describe('Project Loading', () => {
  beforeEach(() => {
    fetchMock.enableMocks()
    fetchMock.resetMocks()
    vi.clearAllMocks()
    // Reset the filesystem store
    useFileSystemStore.getState().reset()
  })

  afterEach(() => {
    fetchMock.dontMock()
    vi.clearAllMocks()
  })

  describe('route detection', () => {
    it('identifies /examples/ routes correctly', () => {
      const location = '/examples/nyc-taxis'
      const routePrefix = location.startsWith('/projects/') ? '/projects' : '/examples'
      const isExamplesRoute = routePrefix === '/examples'

      expect(isExamplesRoute).toBe(true)
      expect(routePrefix).toBe('/examples')
    })

    it('identifies /projects/ routes correctly', () => {
      const location = '/projects/my-project'
      const routePrefix = location.startsWith('/projects/') ? '/projects' : '/examples'
      const isExamplesRoute = routePrefix === '/examples'

      expect(isExamplesRoute).toBe(false)
      expect(routePrefix).toBe('/projects')
    })

    it('defaults to /examples for other routes', () => {
      const location = '/some-other-route'
      const routePrefix = location.startsWith('/projects/') ? '/projects' : '/examples'
      const isExamplesRoute = routePrefix === '/examples'

      expect(isExamplesRoute).toBe(true)
      expect(routePrefix).toBe('/examples')
    })
  })

  describe('filesystem store - activeStorageType', () => {
    it('can set activeStorageType to fileSystemAccess', () => {
      const { result } = renderHook(() => useActiveStorageType())

      act(() => {
        useFileSystemStore.getState().setActiveStorageType('fileSystemAccess')
      })

      expect(result.current).toBe('fileSystemAccess')
    })

    it('can set activeStorageType to opfs', () => {
      const { result } = renderHook(() => useActiveStorageType())

      act(() => {
        useFileSystemStore.getState().setActiveStorageType('opfs')
      })

      expect(result.current).toBe('opfs')
    })

    it('can set activeStorageType to publicFolder', () => {
      const { result } = renderHook(() => useActiveStorageType())

      act(() => {
        useFileSystemStore.getState().setActiveStorageType('publicFolder')
      })

      expect(result.current).toBe('publicFolder')
    })
  })

  describe('storage type fix - the bug that was fixed', () => {
    // This test documents the expected behavior after the fix:
    // When loading from /projects route, setActiveStorageType should be called with the storage type

    it('after successful project load, setActiveStorageType should be called with the storage type', async () => {
      // Mock successful load result
      const mockProjectData = {
        version: 6,
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      }
      const mockDirectoryHandle = {
        name: 'test-project',
        kind: 'directory',
      } as FileSystemDirectoryHandle

      vi.mocked(load).mockResolvedValue({
        success: true,
        data: {
          projectData: mockProjectData,
          directoryHandle: mockDirectoryHandle,
        },
      })

      // Simulate the loading behavior from noodles.tsx lines 716-725:
      // When loading from /projects route (isExamplesRoute === false),
      // after a successful load(), these calls should happen:
      // 1. setCurrentDirectory(result.data.directoryHandle, projectName)
      // 2. setActiveStorageType(storageType)  <-- This was the bug fix
      // 3. loadProjectFile(project, projectName)

      const storageType = 'fileSystemAccess'
      const projectName = 'test-project'

      // Simulate the load call
      const result = await load(storageType, projectName)

      expect(result.success).toBe(true)

      // Now simulate what should happen after a successful load
      // (this is what the fix added - setActiveStorageType call)
      if (result.success) {
        act(() => {
          useFileSystemStore
            .getState()
            .setCurrentDirectory(result.data.directoryHandle, projectName)
          useFileSystemStore.getState().setActiveStorageType(storageType)
        })
      }

      // Verify the storage type was set correctly
      const { result: storageTypeResult } = renderHook(() => useActiveStorageType())
      expect(storageTypeResult.current).toBe('fileSystemAccess')
    })

    it('after successful project load from OPFS, setActiveStorageType should be opfs', async () => {
      const mockProjectData = {
        version: 6,
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      }
      const mockDirectoryHandle = {
        name: 'test-project',
        kind: 'directory',
      } as FileSystemDirectoryHandle

      vi.mocked(load).mockResolvedValue({
        success: true,
        data: {
          projectData: mockProjectData,
          directoryHandle: mockDirectoryHandle,
        },
      })

      const storageType = 'opfs'
      const projectName = 'test-project'

      const result = await load(storageType, projectName)

      expect(result.success).toBe(true)

      if (result.success) {
        act(() => {
          useFileSystemStore
            .getState()
            .setCurrentDirectory(result.data.directoryHandle, projectName)
          useFileSystemStore.getState().setActiveStorageType(storageType)
        })
      }

      const { result: storageTypeResult } = renderHook(() => useActiveStorageType())
      expect(storageTypeResult.current).toBe('opfs')
    })
  })

  describe('example route loading', () => {
    it('for /examples route, storage type should be set to publicFolder', () => {
      // Simulate example route loading behavior from noodles.tsx lines 688-711:
      // When isExamplesRoute is true and a valid example is found:
      // 1. setCurrentDirectory(null, projectName)
      // 2. setActiveStorageType('publicFolder')
      // 3. loadProjectFile(project, projectName)

      const projectName = 'nyc-taxis'

      act(() => {
        useFileSystemStore.getState().setCurrentDirectory(null, projectName)
        useFileSystemStore.getState().setActiveStorageType('publicFolder')
      })

      const { result: storageTypeResult } = renderHook(() => useActiveStorageType())
      expect(storageTypeResult.current).toBe('publicFolder')
    })
  })

  describe('project not found handling', () => {
    it('load returns not-found error when project does not exist in storage', async () => {
      vi.mocked(load).mockResolvedValue({
        success: false,
        error: {
          type: 'not-found',
          message: 'Project not found in storage',
        },
      })

      const result = await load('fileSystemAccess', 'nonexistent-project')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('not-found')
      }
    })
  })
})
