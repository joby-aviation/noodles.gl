import git from 'isomorphic-git'
import {
  DEFAULT_GIT_AUTHOR,
  type GitAuthor,
  type GitSettings,
  getGitSettings,
} from './git-settings'
import { CACHE_DIRECTORY_NAME } from './output-cache'

export interface Commit {
  oid: string
  message: string
  author: { name: string; email: string; timestamp: number }
  parent?: string[]
}

// isomorphic-git tells a missing path from a real failure by Node-style error codes, while the
// File System Access API throws DOMExceptions. Map the two "not there" cases.
function toFsError(error: unknown, filepath: string): unknown {
  const name = error instanceof DOMException ? error.name : undefined
  const code =
    name === 'NotFoundError' ? 'ENOENT' : name === 'TypeMismatchError' ? 'ENOTDIR' : undefined
  if (!code) return error
  return Object.assign(new Error(`${code}: ${filepath}`), { code })
}

async function mapFsErrors<T>(filepath: string, task: () => Promise<T>): Promise<T> {
  try {
    return await task()
  } catch (error) {
    throw toFsError(error, filepath)
  }
}

// Path segments below the project root; '/', '.' and '' all name the root
function splitPath(filepath: string): string[] {
  return filepath.split('/').filter(part => part && part !== '.')
}

// The stat fields isomorphic-git reads. The File System Access API only exposes size and
// modification time, so the change time mirrors it and the rest are fixed.
type FsStat = ReturnType<typeof makeStat>
function makeStat(type: 'file' | 'dir', size: number, mtimeMs: number) {
  return {
    type,
    mode: type === 'dir' ? 0o40755 : 0o100644,
    size,
    ino: 0,
    uid: 0,
    gid: 0,
    dev: 0,
    mtimeMs,
    ctimeMs: mtimeMs,
    isDirectory: () => type === 'dir',
    isFile: () => type === 'file',
    isSymbolicLink: () => false,
  }
}

// Adapter to bridge FileSystemDirectoryHandle to isomorphic-git's fs interface
class FileSystemHandleFS {
  constructor(private rootHandle: FileSystemDirectoryHandle) {}

  // isomorphic-git passes the encoding either as a string or as { encoding }
  async readFile(
    filepath: string,
    options?: string | { encoding?: string }
  ): Promise<Uint8Array | string> {
    const encoding = typeof options === 'string' ? options : options?.encoding
    return mapFsErrors(filepath, async () => {
      const parts = splitPath(filepath)
      let currentHandle: FileSystemDirectoryHandle | FileSystemFileHandle = this.rootHandle

      // Navigate to the file
      for (let i = 0; i < parts.length - 1; i++) {
        if ('getDirectoryHandle' in currentHandle) {
          currentHandle = await currentHandle.getDirectoryHandle(parts[i])
        }
      }

      if ('getFileHandle' in currentHandle) {
        const fileHandle = await currentHandle.getFileHandle(parts[parts.length - 1])
        const file = await fileHandle.getFile()

        // Return string if utf8 encoding requested, otherwise Uint8Array
        if (encoding === 'utf8') {
          return await file.text()
        }

        const buffer = await file.arrayBuffer()
        return new Uint8Array(buffer)
      }

      throw new Error(`Not a directory: ${filepath}`)
    })
  }

  async writeFile(filepath: string, data: Uint8Array | string): Promise<void> {
    const parts = splitPath(filepath)
    let currentHandle: FileSystemDirectoryHandle = this.rootHandle

    // Navigate/create directories
    for (let i = 0; i < parts.length - 1; i++) {
      currentHandle = await currentHandle.getDirectoryHandle(parts[i], { create: true })
    }

    // Write file
    const fileName = parts[parts.length - 1]
    const fileHandle = await currentHandle.getFileHandle(fileName, { create: true })
    const writable = await fileHandle.createWritable()

    if (typeof data === 'string') {
      await writable.write(data)
    } else {
      await writable.write(data)
    }

    await writable.close()
  }

  async unlink(filepath: string): Promise<void> {
    return mapFsErrors(filepath, async () => {
      const parts = splitPath(filepath)
      let currentHandle: FileSystemDirectoryHandle = this.rootHandle

      // Navigate to parent directory
      for (let i = 0; i < parts.length - 1; i++) {
        currentHandle = await currentHandle.getDirectoryHandle(parts[i])
      }

      // Remove file
      const fileName = parts[parts.length - 1]
      await currentHandle.removeEntry(fileName)
    })
  }

  async readdir(filepath: string): Promise<string[]> {
    return mapFsErrors(filepath, async () => {
      let currentHandle: FileSystemDirectoryHandle = this.rootHandle

      if (filepath !== '/' && filepath !== '.') {
        const parts = splitPath(filepath)
        for (const part of parts) {
          currentHandle = await currentHandle.getDirectoryHandle(part)
        }
      }

      const entries: string[] = []
      for await (const entry of currentHandle.values()) {
        entries.push(entry.name)
      }
      return entries
    })
  }

  async mkdir(filepath: string): Promise<void> {
    const parts = splitPath(filepath)
    let currentHandle: FileSystemDirectoryHandle = this.rootHandle

    for (const part of parts) {
      currentHandle = await currentHandle.getDirectoryHandle(part, { create: true })
    }
  }

  async rmdir(filepath: string): Promise<void> {
    return mapFsErrors(filepath, async () => {
      const parts = splitPath(filepath)
      let currentHandle: FileSystemDirectoryHandle = this.rootHandle

      // Navigate to parent
      for (let i = 0; i < parts.length - 1; i++) {
        currentHandle = await currentHandle.getDirectoryHandle(parts[i])
      }

      // Remove directory
      const dirName = parts[parts.length - 1]
      await currentHandle.removeEntry(dirName, { recursive: true })
    })
  }

  async stat(filepath: string): Promise<FsStat> {
    try {
      const parts = splitPath(filepath)
      if (parts.length === 0) return makeStat('dir', 0, 0)

      let currentHandle: FileSystemDirectoryHandle = this.rootHandle
      for (const part of parts.slice(0, -1)) {
        currentHandle = await currentHandle.getDirectoryHandle(part)
      }

      const name = parts[parts.length - 1]
      try {
        await currentHandle.getDirectoryHandle(name)
        return makeStat('dir', 0, 0)
      } catch {
        const file = await (await currentHandle.getFileHandle(name)).getFile()
        return makeStat('file', file.size, file.lastModified)
      }
    } catch {
      // isomorphic-git expects ENOENT error code for missing files
      throw Object.assign(new Error(`ENOENT: no such file or directory, stat '${filepath}'`), {
        code: 'ENOENT',
        errno: -2,
      })
    }
  }

  async lstat(filepath: string) {
    return this.stat(filepath)
  }

  async readlink(_filepath: string): Promise<string> {
    throw new Error('Symlinks not supported')
  }

  async symlink(_target: string, _filepath: string): Promise<void> {
    throw new Error('Symlinks not supported')
  }

  async chmod(_filepath: string, _mode: number): Promise<void> {
    // No-op: FileSystemHandle doesn't support chmod
  }
}

// isomorphic-git takes a promise-based fs object; the adapter implements the subset it uses
// biome-ignore lint/suspicious/noExplicitAny: isomorphic-git's FsClient type is a loose union
type GitFs = any

const DIR = '/'

// Written to .git/config when Noodles creates the repository. A .git without it was put there
// by someone else, and Noodles leaves it alone unless the project opts in.
const MANAGED_CONFIG_PATH = 'noodles.managed'

// Entries every versioned project needs, appended to the folder's .gitignore when missing.
// The cache folder holds machine-written outputs of locked operators, rebuilt on load.
export const REQUIRED_GITIGNORE_ENTRIES = [
  '.DS_Store',
  'node_modules/',
  `/${CACHE_DIRECTORY_NAME}/`,
]

// 'none': no .git yet. 'managed': created by Noodles. 'external': created by something else.
export type RepoStatus = 'none' | 'managed' | 'external'

// Compares ignore patterns while tolerating a missing leading or trailing slash
function normalizeIgnoreEntry(line: string) {
  return line.trim().replace(/^\//, '').replace(/\/$/, '')
}

// Returns the .gitignore text with any missing required entries appended, or null when every
// entry is already there. Existing lines, comments and their order are kept.
export function mergeGitignore(existing: string | null): string | null {
  const present = new Set(
    (existing ?? '')
      .split(/\r?\n/)
      .filter(line => line.trim() && !line.trim().startsWith('#'))
      .map(normalizeIgnoreEntry)
  )
  const missing = REQUIRED_GITIGNORE_ENTRIES.filter(
    entry => !present.has(normalizeIgnoreEntry(entry))
  )
  if (missing.length === 0) return null
  if (!existing) return `${missing.join('\n')}\n`
  const newline = existing.includes('\r\n') ? '\r\n' : '\n'
  const separator = existing.endsWith('\n') ? '' : newline
  return `${existing}${separator}${newline}# Added by Noodles.gl${newline}${missing.join(newline)}${newline}`
}

// Git service for browser-based git operations
export class GitService {
  private fs: FileSystemHandleFS

  constructor(private directoryHandle: FileSystemDirectoryHandle) {
    this.fs = new FileSystemHandleFS(directoryHandle)
  }

  private get git() {
    return { fs: this.fs as GitFs, dir: DIR }
  }

  async getRepoStatus(): Promise<RepoStatus> {
    try {
      await this.directoryHandle.getDirectoryHandle('.git')
    } catch {
      // A .git file is a worktree or submodule pointer to a repository elsewhere
      try {
        await this.directoryHandle.getFileHandle('.git')
        return 'external'
      } catch {
        return 'none'
      }
    }
    try {
      const managed = await git.getConfig({ ...this.git, path: MANAGED_CONFIG_PATH })
      return managed === true || managed === 'true' ? 'managed' : 'external'
    } catch {
      return 'external'
    }
  }

  async isGitRepo(): Promise<boolean> {
    return (await this.getRepoStatus()) !== 'none'
  }

  // Creates the repository and marks it as one Noodles owns
  async initRepo(): Promise<void> {
    await git.init({ ...this.git, defaultBranch: 'main' })
    await git.setConfig({ ...this.git, path: MANAGED_CONFIG_PATH, value: true })
    await this.ensureGitignore()
  }

  // Adds the required entries to .gitignore without touching the user's own rules.
  // Returns true when the file changed.
  async ensureGitignore(): Promise<boolean> {
    let existing: string | null = null
    try {
      existing = (await this.fs.readFile('.gitignore', { encoding: 'utf8' })) as string
    } catch {
      existing = null
    }
    const merged = mergeGitignore(existing)
    if (merged === null) return false
    await this.fs.writeFile('.gitignore', merged)
    return true
  }

  private async hasHead(): Promise<boolean> {
    try {
      await git.resolveRef({ ...this.git, ref: 'HEAD' })
      return true
    } catch {
      return false
    }
  }

  // Stages every addition, change and deletion in the folder (respecting .gitignore) and
  // commits. Returns null without committing when nothing changed.
  async commit(message: string, author: GitAuthor = DEFAULT_GIT_AUTHOR): Promise<string | null> {
    const matrix = await git.statusMatrix(this.git)
    // statusMatrix rows: [filepath, HEAD, workdir, stage]; 1/1/1 is unchanged
    const changed = matrix.filter(
      ([, head, workdir, stage]) => !(head === 1 && workdir === 1 && stage === 1)
    )
    if (changed.length === 0 && (await this.hasHead())) return null

    for (const [filepath, , workdir] of changed) {
      if (workdir === 0) {
        await git.remove({ ...this.git, filepath })
      } else {
        await git.add({ ...this.git, filepath })
      }
    }

    // When the ignore rules changed, stop tracking files they now cover (the files stay on disk)
    if (changed.some(([filepath]) => filepath === '.gitignore')) {
      for (const [filepath, head, workdir] of matrix) {
        if (head === 0 || workdir === 0) continue
        if (await git.isIgnored({ ...this.git, filepath })) {
          await git.remove({ ...this.git, filepath })
        }
      }
    }

    // A first save may find nothing to stage (an empty folder); git can't commit an empty index
    if ((await git.listFiles(this.git)).length === 0 && !(await this.hasHead())) return null

    return git.commit({ ...this.git, message, author: { ...author } })
  }

  async log(options?: { maxCount?: number }): Promise<Commit[]> {
    if (!(await this.hasHead())) return []
    const commits = await git.log({ ...this.git, depth: options?.maxCount })
    return commits.map(commit => ({
      oid: commit.oid,
      message: commit.commit.message.trim(),
      author: {
        name: commit.commit.author.name,
        email: commit.commit.author.email,
        timestamp: commit.commit.author.timestamp * 1000,
      },
      parent: commit.commit.parent,
    }))
  }

  // Every blob in a tree, with paths relative to the project root
  private async readTreeFiles(treeOid: string, prefix = ''): Promise<Map<string, string>> {
    const files = new Map<string, string>()
    const { tree } = await git.readTree({ ...this.git, oid: treeOid })
    for (const entry of tree) {
      const path = prefix ? `${prefix}/${entry.path}` : entry.path
      if (entry.type === 'blob') {
        files.set(path, entry.oid)
      } else if (entry.type === 'tree') {
        for (const [childPath, oid] of await this.readTreeFiles(entry.oid, path)) {
          files.set(childPath, oid)
        }
      }
    }
    return files
  }

  // Makes the folder match `commitOid` and records that as a new commit, so history stays
  // linear and the restore itself can be undone. Callers commit unsaved work first.
  async restore(commitOid: string, author: GitAuthor = DEFAULT_GIT_AUTHOR): Promise<string | null> {
    const { commit: target } = await git.readCommit({ ...this.git, oid: commitOid })
    const targetFiles = await this.readTreeFiles(target.tree)

    // Tracked files the target version didn't have
    for (const filepath of await git.listFiles({ ...this.git, ref: 'HEAD' })) {
      if (!targetFiles.has(filepath)) {
        await this.fs.unlink(filepath).catch(error => {
          console.warn(`Failed to remove ${filepath} during restore:`, error)
        })
      }
    }

    // Locked outputs saved by a later version would otherwise be served for the older graph
    try {
      await this.directoryHandle.removeEntry(CACHE_DIRECTORY_NAME, { recursive: true })
    } catch {
      // No cache folder
    }

    for (const [filepath, oid] of targetFiles) {
      const { blob } = await git.readBlob({ ...this.git, oid })
      await this.fs.writeFile(filepath, blob)
    }

    return this.commit(`Restore to ${commitOid.substring(0, 7)}`, author)
  }
}

export async function createGitService(
  directoryHandle: FileSystemDirectoryHandle
): Promise<GitService> {
  return new GitService(directoryHandle)
}

// Git operations rewrite .git/index, so they run one at a time: a load-time init, an autosave
// and a restore can otherwise interleave.
let queue: Promise<unknown> = Promise.resolve()
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  queue = run.catch(() => {})
  return run
}

// Whether saves of this project may commit to the folder's repository right now
export async function canVersionProject(
  directoryHandle: FileSystemDirectoryHandle,
  settings: GitSettings
): Promise<{ allowed: boolean; status: RepoStatus }> {
  const status = await new GitService(directoryHandle).getRepoStatus()
  const allowed = settings.enabled && (status !== 'external' || settings.useExistingRepo)
  return { allowed, status }
}

// Commits the project folder after a save. Creates the repository on first use; never commits
// into a repository Noodles didn't create unless the project opted in. Returns the commit oid,
// or null when nothing was committed.
export function commitProjectSnapshot(
  directoryHandle: FileSystemDirectoryHandle,
  projectName: string,
  message: string
): Promise<string | null> {
  return enqueue(async () => {
    const settings = getGitSettings(projectName)
    const { allowed, status } = await canVersionProject(directoryHandle, settings)
    if (!allowed) return null
    const service = new GitService(directoryHandle)
    if (status === 'none') {
      await service.initRepo()
    } else {
      await service.ensureGitignore()
    }
    return service.commit(message, settings.author)
  })
}

// Starts version history for a project opened without one. Leaves existing repositories alone.
export function initProjectRepo(
  directoryHandle: FileSystemDirectoryHandle,
  projectName: string
): Promise<string | null> {
  return enqueue(async () => {
    const settings = getGitSettings(projectName)
    if (!settings.enabled) return null
    const service = new GitService(directoryHandle)
    if ((await service.getRepoStatus()) !== 'none') return null
    await service.initRepo()
    return service.commit('Start version history', settings.author)
  })
}

// Commits whatever is on disk, then restores `commitOid`
export function restoreProjectVersion(
  directoryHandle: FileSystemDirectoryHandle,
  projectName: string,
  commitOid: string
): Promise<string | null> {
  return enqueue(async () => {
    const settings = getGitSettings(projectName)
    const { allowed } = await canVersionProject(directoryHandle, settings)
    if (!allowed) throw new Error('Version control is off for this project')
    const service = new GitService(directoryHandle)
    await service.commit('Before restore', settings.author)
    return service.restore(commitOid, settings.author)
  })
}
