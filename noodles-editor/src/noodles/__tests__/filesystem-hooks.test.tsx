// Tests for filesystem store hooks
// Tests Zustand-based state management for file system operations
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  useActiveStorageType,
  useCurrentDirectory,
  useCurrentProjectName,
  useFileSystemError,
  useFileSystemStore,
  useFileSystemSupport,
} from '../filesystem-store'

// Mock directory handle for testing
function createMockDirectoryHandle(name: string): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name,
  } as FileSystemDirectoryHandle
}

describe('FileSystem Hooks', () => {
  afterEach(() => {
    const { reset } = useFileSystemStore.getState()
    reset()
  })

  describe('useCurrentDirectory', () => {
    it('starts with null directory', () => {
      const { result } = renderHook(() => useCurrentDirectory())
      expect(result.current).toBeNull()
    })

    it('updates when directory is set', () => {
      const { result } = renderHook(() => useCurrentDirectory())
      const mockHandle = createMockDirectoryHandle('test-project')

      act(() => {
        useFileSystemStore.getState().setCurrentDirectory(mockHandle)
      })

      expect(result.current).toBe(mockHandle)
      expect(result.current?.name).toBe('test-project')
    })

    it('can be cleared back to null', () => {
      const { result } = renderHook(() => useCurrentDirectory())
      const mockHandle = createMockDirectoryHandle('test-project')

      act(() => {
        useFileSystemStore.getState().setCurrentDirectory(mockHandle)
      })

      expect(result.current).toBe(mockHandle)

      act(() => {
        useFileSystemStore.getState().setCurrentDirectory(null)
      })

      expect(result.current).toBeNull()
    })
  })

  describe('useCurrentProjectName', () => {
    it('starts with null', () => {
      const { result } = renderHook(() => useCurrentProjectName())
      expect(result.current).toBeNull()
    })

    it('uses handle name when only handle is provided', () => {
      const { result } = renderHook(() => useCurrentProjectName())
      const mockHandle = createMockDirectoryHandle('my-project')

      act(() => {
        useFileSystemStore.getState().setCurrentDirectory(mockHandle)
      })

      expect(result.current).toBe('my-project')
    })

    it('uses explicit project name when provided', () => {
      const { result } = renderHook(() => useCurrentProjectName())
      const mockHandle = createMockDirectoryHandle('directory-name')

      act(() => {
        useFileSystemStore.getState().setCurrentDirectory(mockHandle, 'custom-project-name')
      })

      expect(result.current).toBe('custom-project-name')
    })

    it('clears when directory is cleared', () => {
      const { result } = renderHook(() => useCurrentProjectName())
      const mockHandle = createMockDirectoryHandle('test-project')

      act(() => {
        useFileSystemStore.getState().setCurrentDirectory(mockHandle)
      })

      expect(result.current).toBe('test-project')

      act(() => {
        useFileSystemStore.getState().setCurrentDirectory(null)
      })

      expect(result.current).toBeNull()
    })
  })

  describe('useFileSystemError', () => {
    it('starts with no error', () => {
      const { result } = renderHook(() => useFileSystemError())
      expect(result.current).toBeNull()
    })

    it('updates when error is set', () => {
      const { result } = renderHook(() => useFileSystemError())
      const testError = {
        type: 'permission-denied' as const,
        message: 'Permission denied',
      }

      act(() => {
        useFileSystemStore.getState().setError(testError)
      })

      expect(result.current).toEqual(testError)
    })

    it('can be cleared', () => {
      const { result } = renderHook(() => useFileSystemError())
      const testError = {
        type: 'not-found' as const,
        message: 'File not found',
      }

      act(() => {
        useFileSystemStore.getState().setError(testError)
      })

      expect(result.current).toEqual(testError)

      act(() => {
        useFileSystemStore.getState().clearError()
      })

      expect(result.current).toBeNull()
    })

    it('clears when setting a new directory', () => {
      const { result } = renderHook(() => useFileSystemError())
      const testError = {
        type: 'permission-denied' as const,
        message: 'Permission denied',
      }
      const mockHandle = createMockDirectoryHandle('test-project')

      act(() => {
        useFileSystemStore.getState().setError(testError)
      })

      expect(result.current).toEqual(testError)

      act(() => {
        useFileSystemStore.getState().setCurrentDirectory(mockHandle)
      })

      expect(result.current).toBeNull()
    })
  })

  describe('useActiveStorageType', () => {
    it('starts with a default storage type', () => {
      const { result } = renderHook(() => useActiveStorageType())
      expect(['opfs', 'fileSystemAccess', 'publicFolder']).toContain(result.current)
    })

    it('can be updated', () => {
      const { result } = renderHook(() => useActiveStorageType())

      act(() => {
        useFileSystemStore.getState().setActiveStorageType('opfs')
      })

      expect(result.current).toBe('opfs')

      act(() => {
        useFileSystemStore.getState().setActiveStorageType('fileSystemAccess')
      })

      expect(result.current).toBe('fileSystemAccess')
    })
  })

  describe('useFileSystemSupport', () => {
    it('returns support information', () => {
      const { result } = renderHook(() => useFileSystemSupport())

      expect(result.current).toHaveProperty('opfs')
      expect(result.current).toHaveProperty('fileSystemAccess')
      expect(typeof result.current.opfs).toBe('boolean')
      expect(typeof result.current.fileSystemAccess).toBe('boolean')
    })
  })

  describe('Full store integration', () => {
    it('can use multiple hooks together', () => {
      const { result: directoryResult } = renderHook(() => useCurrentDirectory())
      const { result: errorResult } = renderHook(() => useFileSystemError())
      const { result: projectNameResult } = renderHook(() => useCurrentProjectName())

      const mockHandle = createMockDirectoryHandle('integration-test')

      act(() => {
        const store = useFileSystemStore.getState()
        store.setCurrentDirectory(mockHandle, 'Integration Project')
      })

      expect(directoryResult.current?.name).toBe('integration-test')
      expect(projectNameResult.current).toBe('Integration Project')
      expect(errorResult.current).toBeNull()
    })

    it('reset clears all state', () => {
      const { result: directoryResult } = renderHook(() => useCurrentDirectory())
      const { result: errorResult } = renderHook(() => useFileSystemError())
      const mockHandle = createMockDirectoryHandle('test-project')
      const testError = {
        type: 'unknown' as const,
        message: 'Test error',
      }

      act(() => {
        const store = useFileSystemStore.getState()
        store.setCurrentDirectory(mockHandle)
        store.setError(testError)
      })

      expect(directoryResult.current).toBe(mockHandle)
      expect(errorResult.current).toEqual(testError)

      act(() => {
        useFileSystemStore.getState().reset()
      })

      expect(directoryResult.current).toBeNull()
      expect(errorResult.current).toBeNull()
    })
  })
})
