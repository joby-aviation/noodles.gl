import git from 'isomorphic-git'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  commitProjectSnapshot,
  createGitService,
  initProjectRepo,
  mergeGitignore,
  restoreProjectVersion,
} from './git-service'
import { getGitSettings, saveGitSettings, shouldAutosave } from './git-settings'

// Each write is a second later, as on a real disk: git compares modification times in whole
// seconds before hashing
let clock = 1
function tick() {
  clock += 1000
  return clock
}

// In-memory FileSystemDirectoryHandle with nested folders and working removeEntry
class MockFileSystemDirectoryHandle {
  kind = 'directory' as const
  name: string
  files = new Map<string, Uint8Array | string>()
  dirs = new Map<string, MockFileSystemDirectoryHandle>()
  mtimes = new Map<string, number>()

  constructor(name = 'test-project') {
    this.name = name
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    const existing = this.dirs.get(name)
    if (existing) return existing
    if (this.files.has(name))
      throw new DOMException(`Not a directory: ${name}`, 'TypeMismatchError')
    if (options?.create) {
      const dir = new MockFileSystemDirectoryHandle(name)
      this.dirs.set(name, dir)
      return dir
    }
    throw new DOMException(`Directory not found: ${name}`, 'NotFoundError')
  }

  async getFileHandle(name: string, options?: { create?: boolean }) {
    if (this.dirs.has(name)) throw new DOMException(`Not a file: ${name}`, 'TypeMismatchError')
    if (!this.files.has(name)) {
      if (!options?.create) throw new DOMException(`File not found: ${name}`, 'NotFoundError')
      this.files.set(name, new Uint8Array())
    }
    return {
      kind: 'file' as const,
      name,
      getFile: async () => {
        const content = this.files.get(name) ?? new Uint8Array()
        const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content
        return new File([bytes], name, { lastModified: this.mtimes.get(name) ?? 0 })
      },
      createWritable: async () => {
        let data: string | Uint8Array = ''
        return {
          write: async (chunk: string | Uint8Array) => {
            data = chunk
          },
          close: async () => {
            this.files.set(name, data)
            this.mtimes.set(name, tick())
          },
        }
      },
    }
  }

  async removeEntry(name: string, _options?: { recursive?: boolean }) {
    if (this.files.delete(name) || this.dirs.delete(name)) return
    throw new DOMException(`Not found: ${name}`, 'NotFoundError')
  }

  async *values() {
    for (const name of this.files.keys()) yield await this.getFileHandle(name)
    for (const dir of this.dirs.values()) yield dir
  }
}

function asHandle(mock: MockFileSystemDirectoryHandle) {
  return mock as unknown as FileSystemDirectoryHandle
}

function folderFor(mock: MockFileSystemDirectoryHandle, path: string) {
  const parts = path.split('/')
  let dir = mock
  for (const part of parts.slice(0, -1)) {
    let child = dir.dirs.get(part)
    if (!child) {
      child = new MockFileSystemDirectoryHandle(part)
      dir.dirs.set(part, child)
    }
    dir = child
  }
  return { dir, name: parts[parts.length - 1] }
}

function writeFile(mock: MockFileSystemDirectoryHandle, path: string, content: string) {
  const { dir, name } = folderFor(mock, path)
  dir.files.set(name, content)
  dir.mtimes.set(name, tick())
}

function readFile(mock: MockFileSystemDirectoryHandle, path: string): string | undefined {
  const { dir, name } = folderFor(mock, path)
  const content = dir.files.get(name)
  if (content === undefined) return undefined
  return typeof content === 'string' ? content : new TextDecoder().decode(content)
}

function deleteFile(mock: MockFileSystemDirectoryHandle, path: string) {
  const { dir, name } = folderFor(mock, path)
  dir.files.delete(name)
}

// Files in the HEAD commit
async function committedFiles(mock: MockFileSystemDirectoryHandle) {
  const service = await createGitService(asHandle(mock))
  // biome-ignore lint/suspicious/noExplicitAny: reaching the adapter for a direct isomorphic-git call
  const fs = (service as any).fs
  return (await git.listFiles({ fs, dir: '/', ref: 'HEAD' })).sort()
}

const PROJECT = 'test-project'

describe('git-service', () => {
  let mock: MockFileSystemDirectoryHandle

  beforeEach(() => {
    mock = new MockFileSystemDirectoryHandle(PROJECT)
    localStorage.clear()
    writeFile(mock, 'noodles.json', '{"version":1}')
  })

  describe('repository ownership', () => {
    it('reports no repository before the first save', async () => {
      const service = await createGitService(asHandle(mock))
      expect(await service.getRepoStatus()).toBe('none')
    })

    it('marks a repository it creates as managed', async () => {
      const service = await createGitService(asHandle(mock))
      await service.initRepo()
      expect(await service.getRepoStatus()).toBe('managed')
    })

    it('does not commit into a repository it did not create', async () => {
      const service = await createGitService(asHandle(mock))
      // biome-ignore lint/suspicious/noExplicitAny: reaching the adapter for a direct isomorphic-git call
      await git.init({ fs: (service as any).fs, dir: '/', defaultBranch: 'main' })
      writeFile(mock, 'notes.txt', 'user file')

      expect(await service.getRepoStatus()).toBe('external')
      expect(await commitProjectSnapshot(asHandle(mock), PROJECT, 'Save')).toBeNull()
      expect(await service.log()).toEqual([])
      expect(readFile(mock, '.gitignore')).toBeUndefined()
    })

    it('commits into an existing repository when the project opts in', async () => {
      const service = await createGitService(asHandle(mock))
      // biome-ignore lint/suspicious/noExplicitAny: reaching the adapter for a direct isomorphic-git call
      await git.init({ fs: (service as any).fs, dir: '/', defaultBranch: 'main' })
      saveGitSettings({ useExistingRepo: true }, PROJECT)

      expect(await commitProjectSnapshot(asHandle(mock), PROJECT, 'Save')).toEqual(
        expect.any(String)
      )
      expect((await service.log()).map(c => c.message)).toEqual(['Save'])
    })

    it('treats a .git file (worktree or submodule) as external', async () => {
      writeFile(mock, '.git', 'gitdir: ../elsewhere')
      const service = await createGitService(asHandle(mock))
      expect(await service.getRepoStatus()).toBe('external')
      expect(await initProjectRepo(asHandle(mock), PROJECT)).toBeNull()
    })
  })

  describe('.gitignore', () => {
    it('keeps custom rules and appends the missing required entries', () => {
      const merged = mergeGitignore('# mine\n*.log\nnode_modules\n')
      expect(merged).toBe(
        '# mine\n*.log\nnode_modules\n\n# Added by Noodles.gl\n.DS_Store\n/cache/\n'
      )
    })

    it('leaves a file with every required entry alone', () => {
      expect(mergeGitignore('.DS_Store\nnode_modules/\ncache/\n')).toBeNull()
    })

    it('does not overwrite a custom .gitignore when creating the repository', async () => {
      writeFile(mock, '.gitignore', 'secrets.txt')
      writeFile(mock, 'secrets.txt', 'shh')
      await commitProjectSnapshot(asHandle(mock), PROJECT, 'Save')

      expect(readFile(mock, '.gitignore')).toContain('secrets.txt\n')
      expect(readFile(mock, '.gitignore')).toContain('/cache/')
      expect(await committedFiles(mock)).toEqual(['.gitignore', 'noodles.json'])
    })

    it('keeps the cache folder out of history', async () => {
      writeFile(mock, 'cache/loader.json', '{"outputs":{}}')
      await commitProjectSnapshot(asHandle(mock), PROJECT, 'Save')
      expect(await committedFiles(mock)).toEqual(['.gitignore', 'noodles.json'])
    })

    it('stops tracking a cache folder committed before it was ignored', async () => {
      const service = await createGitService(asHandle(mock))
      await service.initRepo()
      writeFile(mock, '.gitignore', 'node_modules/\n')
      writeFile(mock, 'cache/loader.json', '{"outputs":{}}')
      await service.commit('Old save')
      expect(await committedFiles(mock)).toContain('cache/loader.json')

      await commitProjectSnapshot(asHandle(mock), PROJECT, 'Save')
      expect(await committedFiles(mock)).toEqual(['.gitignore', 'noodles.json'])
      expect(readFile(mock, 'cache/loader.json')).toBe('{"outputs":{}}')
    })
  })

  describe('commit', () => {
    it('stages deleted files as removals', async () => {
      writeFile(mock, 'data/points.csv', 'a,b')
      await commitProjectSnapshot(asHandle(mock), PROJECT, 'First')
      expect(await committedFiles(mock)).toContain('data/points.csv')

      deleteFile(mock, 'data/points.csv')
      await commitProjectSnapshot(asHandle(mock), PROJECT, 'Second')
      expect(await committedFiles(mock)).not.toContain('data/points.csv')
    })

    it('skips the commit when nothing changed', async () => {
      await commitProjectSnapshot(asHandle(mock), PROJECT, 'First')
      expect(await commitProjectSnapshot(asHandle(mock), PROJECT, 'Second')).toBeNull()
      const service = await createGitService(asHandle(mock))
      expect((await service.log()).map(c => c.message)).toEqual(['First'])
    })

    it('does nothing when version control is off for the project', async () => {
      saveGitSettings({ enabled: false }, PROJECT)
      expect(await commitProjectSnapshot(asHandle(mock), PROJECT, 'Save')).toBeNull()
      expect(mock.dirs.has('.git')).toBe(false)
    })

    it('uses the saved author', async () => {
      saveGitSettings({ author: { name: 'Ada', email: 'ada@example.com' } })
      await commitProjectSnapshot(asHandle(mock), PROJECT, 'Save')
      const [commit] = await (await createGitService(asHandle(mock))).log()
      expect(commit.author).toMatchObject({ name: 'Ada', email: 'ada@example.com' })
    })
  })

  describe('restore', () => {
    it('restores files in subfolders and removes files added later', async () => {
      writeFile(mock, 'data/points.csv', 'v1')
      writeFile(mock, 'data/nested/lines.csv', 'v1')
      const first = await commitProjectSnapshot(asHandle(mock), PROJECT, 'First')

      writeFile(mock, 'noodles.json', '{"version":2}')
      writeFile(mock, 'data/points.csv', 'v2')
      deleteFile(mock, 'data/nested/lines.csv')
      writeFile(mock, 'data/extra.csv', 'new')
      await commitProjectSnapshot(asHandle(mock), PROJECT, 'Second')

      await restoreProjectVersion(asHandle(mock), PROJECT, first as string)

      expect(readFile(mock, 'noodles.json')).toBe('{"version":1}')
      expect(readFile(mock, 'data/points.csv')).toBe('v1')
      expect(readFile(mock, 'data/nested/lines.csv')).toBe('v1')
      expect(readFile(mock, 'data/extra.csv')).toBeUndefined()

      const log = await (await createGitService(asHandle(mock))).log()
      expect(log.map(c => c.message)).toEqual([
        `Restore to ${(first as string).slice(0, 7)}`,
        'Second',
        'First',
      ])
    })

    it('commits changes on disk before restoring', async () => {
      const first = await commitProjectSnapshot(asHandle(mock), PROJECT, 'First')
      writeFile(mock, 'noodles.json', '{"version":2}')

      await restoreProjectVersion(asHandle(mock), PROJECT, first as string)

      const log = await (await createGitService(asHandle(mock))).log()
      expect(log.map(c => c.message)).toEqual([
        `Restore to ${(first as string).slice(0, 7)}`,
        'Before restore',
        'First',
      ])
    })

    it('clears the output cache so a later version is not served', async () => {
      const first = await commitProjectSnapshot(asHandle(mock), PROJECT, 'First')
      writeFile(mock, 'cache/loader.json', '{"outputs":{}}')

      await restoreProjectVersion(asHandle(mock), PROJECT, first as string)
      expect(mock.dirs.has('cache')).toBe(false)
    })
  })
})

describe('git settings', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns defaults when none are saved', () => {
    const settings = getGitSettings('a')
    expect(settings).toMatchObject({
      enabled: true,
      autoCommit: true,
      autoCommitDelay: 30000,
      useExistingRepo: false,
    })
  })

  it('scopes project settings to one project', () => {
    saveGitSettings({ enabled: false, autoCommitDelay: 60000 }, 'a')
    expect(getGitSettings('a')).toMatchObject({ enabled: false, autoCommitDelay: 60000 })
    expect(getGitSettings('b')).toMatchObject({ enabled: true, autoCommitDelay: 30000 })
  })

  it('shares the author across projects', () => {
    saveGitSettings({ author: { name: 'Test User', email: 'test@example.com' } }, 'a')
    expect(getGitSettings('b').author).toEqual({ name: 'Test User', email: 'test@example.com' })
  })

  it('drops project settings saved without a project', () => {
    saveGitSettings({ enabled: false })
    expect(getGitSettings('a').enabled).toBe(true)
  })

  describe('shouldAutosave', () => {
    const base = {
      settings: getGitSettings('a'),
      storageType: 'fileSystemAccess' as const,
      hasUnsavedChanges: true,
      isExamplesRoute: false,
    }

    it('autosaves a dirty project with versioning on', () => {
      expect(shouldAutosave(base)).toBe(true)
    })

    it('does not autosave when version control is off', () => {
      expect(shouldAutosave({ ...base, settings: { ...base.settings, enabled: false } })).toBe(
        false
      )
    })

    it('does not autosave when autosave is off', () => {
      expect(shouldAutosave({ ...base, settings: { ...base.settings, autoCommit: false } })).toBe(
        false
      )
    })

    it('does not autosave unsaved drafts or examples', () => {
      expect(shouldAutosave({ ...base, storageType: 'memory' })).toBe(false)
      expect(shouldAutosave({ ...base, isExamplesRoute: true })).toBe(false)
      expect(shouldAutosave({ ...base, hasUnsavedChanges: false })).toBe(false)
    })
  })
})
