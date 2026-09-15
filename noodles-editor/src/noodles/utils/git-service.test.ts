import { describe, it, expect, beforeEach } from 'vitest'
import { createGitService, getGitSettings, saveGitSettings } from './git-service'

// Mock FileSystemDirectoryHandle for testing
class MockFileSystemDirectoryHandle implements FileSystemDirectoryHandle {
  kind = 'directory' as const
  name: string
  private files = new Map<string, Uint8Array | string>()
  private dirs = new Map<string, MockFileSystemDirectoryHandle>()

  constructor(name = 'test-project') {
    this.name = name
  }

  async getDirectoryHandle(
    name: string,
    options?: { create?: boolean }
  ): Promise<MockFileSystemDirectoryHandle> {
    if (this.dirs.has(name)) {
      return this.dirs.get(name)!
    }
    if (options?.create) {
      const dir = new MockFileSystemDirectoryHandle(name)
      this.dirs.set(name, dir)
      return dir
    }
    throw new Error(`Directory not found: ${name}`)
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle> {
    if (!this.files.has(name) && !options?.create) {
      throw new Error(`File not found: ${name}`)
    }
    return {
      kind: 'file',
      name,
      getFile: async () => {
        const content = this.files.get(name) || new Uint8Array()
        const buffer = typeof content === 'string' ? new TextEncoder().encode(content) : content
        return new File([buffer], name, { lastModified: Date.now() })
      },
      createWritable: async () => {
        let data: string | Uint8Array = ''
        return {
          write: async (chunk: any) => {
            data = chunk
          },
          close: async () => {
            this.files.set(name, data)
          },
        } as any
      },
    } as any
  }

  async removeEntry(_name: string, _options?: { recursive?: boolean }): Promise<void> {
    // Mock implementation
  }

  async *values(): AsyncIterableIterator<FileSystemHandle> {
    for (const name of this.files.keys()) {
      yield (await this.getFileHandle(name)) as any
    }
    for (const name of this.dirs.keys()) {
      yield (await this.getDirectoryHandle(name)) as any
    }
  }

  async *keys(): AsyncIterableIterator<string> {
    for (const name of this.files.keys()) {
      yield name
    }
    for (const name of this.dirs.keys()) {
      yield name
    }
  }

  async *entries(): AsyncIterableIterator<[string, FileSystemHandle]> {
    for (const name of this.files.keys()) {
      yield [name, (await this.getFileHandle(name)) as any]
    }
    for (const name of this.dirs.keys()) {
      yield [name, (await this.getDirectoryHandle(name)) as any]
    }
  }

  [Symbol.asyncIterator]() {
    return this.entries()
  }

  async resolve(_possibleDescendant: FileSystemHandle): Promise<string[] | null> {
    return null
  }

  async isSameEntry(_other: FileSystemHandle): Promise<boolean> {
    return false
  }

  async queryPermission(
    _descriptor?: FileSystemHandlePermissionDescriptor
  ): Promise<PermissionState> {
    return 'granted'
  }

  async requestPermission(
    _descriptor?: FileSystemHandlePermissionDescriptor
  ): Promise<PermissionState> {
    return 'granted'
  }
}

describe('git-service', () => {
  let mockHandle: MockFileSystemDirectoryHandle

  beforeEach(() => {
    mockHandle = new MockFileSystemDirectoryHandle()
    // Clear localStorage
    localStorage.clear()
  })

  // Helper to create noodles.json (required for isGitRepo check)
  async function createNoodlesJson(handle: MockFileSystemDirectoryHandle) {
    const fileHandle = await handle.getFileHandle('noodles.json', { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write('{}')
    await writable.close()
  }

  describe('GitService', () => {
    it('should detect when directory is not a git repo', async () => {
      const gitService = await createGitService(mockHandle)
      const isRepo = await gitService.isGitRepo()
      expect(isRepo).toBe(false)
    })

    it('should initialize a git repo', async () => {
      const gitService = await createGitService(mockHandle)
      await createNoodlesJson(mockHandle)
      await gitService.initRepo()

      const isRepo = await gitService.isGitRepo()
      expect(isRepo).toBe(true)
    })

    it('should create a commit', async () => {
      const gitService = await createGitService(mockHandle)
      await createNoodlesJson(mockHandle)
      await gitService.initRepo()

      // Add a test file
      const fileHandle = await mockHandle.getFileHandle('test.txt', { create: true })
      const writable = await fileHandle.createWritable()
      await writable.write('test content')
      await writable.close()

      const sha = await gitService.commit('Test commit')
      expect(sha).toBeDefined()
      expect(typeof sha).toBe('string')
    })

    it('should retrieve commit log', async () => {
      const gitService = await createGitService(mockHandle)
      await createNoodlesJson(mockHandle)
      await gitService.initRepo()

      // Create first commit
      const fileHandle = await mockHandle.getFileHandle('test.txt', { create: true })
      const writable = await fileHandle.createWritable()
      await writable.write('test content')
      await writable.close()

      await gitService.commit('First commit')
      await gitService.commit('Second commit')

      const log = await gitService.log({ maxCount: 10 })
      expect(log.length).toBeGreaterThan(0)
      expect(log[0].message).toBe('Second commit')
      expect(log[0].author).toBeDefined()
      expect(log[0].oid).toBeDefined()
    })
  })

  describe('Git Settings', () => {
    it('should return default settings when none saved', () => {
      const settings = getGitSettings()
      expect(settings.enabled).toBe(true)
      expect(settings.autoCommit).toBe(true)
      expect(settings.autoCommitDelay).toBe(30000)
    })

    it('should save and retrieve settings', () => {
      saveGitSettings({ autoCommitDelay: 60000 })
      const settings = getGitSettings()
      expect(settings.autoCommitDelay).toBe(60000)
      expect(settings.enabled).toBe(true) // Should preserve other defaults
    })

    it('should allow disabling git', () => {
      saveGitSettings({ enabled: false })
      const settings = getGitSettings()
      expect(settings.enabled).toBe(false)
    })

    it('should allow custom author', () => {
      saveGitSettings({
        author: { name: 'Test User', email: 'test@example.com' },
      })
      const settings = getGitSettings()
      expect(settings.author.name).toBe('Test User')
      expect(settings.author.email).toBe('test@example.com')
    })
  })
})
