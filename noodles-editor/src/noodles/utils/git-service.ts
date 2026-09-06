import git from 'isomorphic-git'

export interface Commit {
  oid: string
  message: string
  author: { name: string; email: string; timestamp: number }
  parent?: string[]
}

export interface GitSettings {
  enabled: boolean
  autoCommit: boolean
  autoCommitDelay: number
  author: { name: string; email: string }
}

const DEFAULT_AUTHOR = {
  name: 'Noodles User',
  email: 'user@noodles.local',
}

const DEFAULT_SETTINGS: GitSettings = {
  enabled: true,
  autoCommit: true,
  autoCommitDelay: 30000, // 30 seconds
  author: DEFAULT_AUTHOR,
}

// Adapter to bridge FileSystemDirectoryHandle to isomorphic-git's fs interface
class FileSystemHandleFS {
  constructor(private rootHandle: FileSystemDirectoryHandle) {}

  async readFile(filepath: string): Promise<Uint8Array> {
    const parts = filepath.split('/').filter(Boolean)
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
      const buffer = await file.arrayBuffer()
      return new Uint8Array(buffer)
    }

    throw new Error(`Not a directory: ${filepath}`)
  }

  async writeFile(filepath: string, data: Uint8Array | string): Promise<void> {
    const parts = filepath.split('/').filter(Boolean)
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
    const parts = filepath.split('/').filter(Boolean)
    let currentHandle: FileSystemDirectoryHandle = this.rootHandle

    // Navigate to parent directory
    for (let i = 0; i < parts.length - 1; i++) {
      currentHandle = await currentHandle.getDirectoryHandle(parts[i])
    }

    // Remove file
    const fileName = parts[parts.length - 1]
    await currentHandle.removeEntry(fileName)
  }

  async readdir(filepath: string): Promise<string[]> {
    let currentHandle: FileSystemDirectoryHandle = this.rootHandle

    if (filepath !== '/' && filepath !== '.') {
      const parts = filepath.split('/').filter(Boolean)
      for (const part of parts) {
        currentHandle = await currentHandle.getDirectoryHandle(part)
      }
    }

    const entries: string[] = []
    for await (const entry of currentHandle.values()) {
      entries.push(entry.name)
    }
    return entries
  }

  async mkdir(filepath: string): Promise<void> {
    const parts = filepath.split('/').filter(Boolean)
    let currentHandle: FileSystemDirectoryHandle = this.rootHandle

    for (const part of parts) {
      currentHandle = await currentHandle.getDirectoryHandle(part, { create: true })
    }
  }

  async rmdir(filepath: string): Promise<void> {
    const parts = filepath.split('/').filter(Boolean)
    let currentHandle: FileSystemDirectoryHandle = this.rootHandle

    // Navigate to parent
    for (let i = 0; i < parts.length - 1; i++) {
      currentHandle = await currentHandle.getDirectoryHandle(parts[i])
    }

    // Remove directory
    const dirName = parts[parts.length - 1]
    await currentHandle.removeEntry(dirName, { recursive: true })
  }

  async stat(filepath: string): Promise<any> {
    try {
      const parts = filepath.split('/').filter(Boolean)
      let currentHandle: FileSystemDirectoryHandle | FileSystemFileHandle = this.rootHandle

      if (parts.length === 0) {
        return {
          type: 'dir',
          mode: 0o777,
          size: 0,
          ino: 0,
          mtimeMs: Date.now(),
          isDirectory: () => true,
          isFile: () => false,
          isSymbolicLink: () => false,
        }
      }

      // Navigate to the target
      for (let i = 0; i < parts.length - 1; i++) {
        if ('getDirectoryHandle' in currentHandle) {
          currentHandle = await currentHandle.getDirectoryHandle(parts[i])
        }
      }

      const name = parts[parts.length - 1]

      if ('getDirectoryHandle' in currentHandle) {
        try {
          await currentHandle.getDirectoryHandle(name)
          return {
            type: 'dir',
            mode: 0o777,
            size: 0,
            ino: 0,
            mtimeMs: Date.now(),
            isDirectory: () => true,
            isFile: () => false,
            isSymbolicLink: () => false,
          }
        } catch {
          // Try as file
          const fileHandle = await currentHandle.getFileHandle(name)
          const file = await fileHandle.getFile()
          return {
            type: 'file',
            mode: 0o666,
            size: file.size,
            ino: 0,
            mtimeMs: file.lastModified,
            isDirectory: () => false,
            isFile: () => true,
            isSymbolicLink: () => false,
          }
        }
      }

      throw new Error(`Not found: ${filepath}`)
    } catch (error) {
      // isomorphic-git expects ENOENT error code for missing files
      const err = new Error(`ENOENT: no such file or directory, stat '${filepath}'`) as any
      err.code = 'ENOENT'
      err.errno = -2
      throw err
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

// Git service for browser-based git operations
export class GitService {
  private fs: FileSystemHandleFS

  constructor(private directoryHandle: FileSystemDirectoryHandle) {
    this.fs = new FileSystemHandleFS(directoryHandle)
  }

  // Check if directory contains a git repository
  async isGitRepo(): Promise<boolean> {
    try {
      await this.directoryHandle.getDirectoryHandle('.git')
      return true
    } catch {
      return false
    }
  }

  // Initialize a new git repository
  async initRepo(): Promise<void> {
    await git.init({
      fs: this.fs as any,
      dir: '/',
      defaultBranch: 'main',
    })

    // Create initial .gitignore
    await this.fs.writeFile('.gitignore', 'node_modules/\n.DS_Store\n')
  }

  // Commit all changes with a message
  async commit(message: string, author?: { name: string; email: string }): Promise<string> {
    const commitAuthor = author || DEFAULT_AUTHOR

    // Stage all files
    const files = await this.listFiles('/')
    for (const file of files) {
      if (!file.startsWith('.git/')) {
        try {
          await git.add({
            fs: this.fs as any,
            dir: '/',
            filepath: file,
          })
        } catch (error) {
          console.warn(`Failed to stage file ${file}:`, error)
        }
      }
    }

    // Create commit
    const sha = await git.commit({
      fs: this.fs as any,
      dir: '/',
      message,
      author: {
        name: commitAuthor.name,
        email: commitAuthor.email,
      },
    })

    return sha
  }

  // Get commit history
  async log(options?: { maxCount?: number }): Promise<Commit[]> {
    const commits = await git.log({
      fs: this.fs as any,
      dir: '/',
      depth: options?.maxCount,
    })

    return commits.map(commit => ({
      oid: commit.oid,
      message: commit.commit.message,
      author: {
        name: commit.commit.author.name,
        email: commit.commit.author.email,
        timestamp: commit.commit.author.timestamp * 1000, // Convert to milliseconds
      },
      parent: commit.commit.parent,
    }))
  }

  // Get diff between two commits (or working tree vs HEAD)
  async diff(options?: { ref1?: string; ref2?: string }): Promise<string> {
    // For now, return a placeholder
    // Full diff implementation requires walking the tree and comparing
    // This would be implemented in Phase 2 with a proper diff viewer
    const ref1 = options?.ref1 || 'HEAD'
    const ref2 = options?.ref2 || 'workdir'

    console.log(`Diff between ${ref1} and ${ref2} not yet implemented`)
    return 'Diff viewer coming in Phase 2'
  }

  // Helper: recursively list all files in a directory
  private async listFiles(dir: string, basePath = ''): Promise<string[]> {
    const entries = await this.fs.readdir(dir === '/' ? '.' : dir)
    const files: string[] = []

    for (const entry of entries) {
      const fullPath = basePath ? `${basePath}/${entry}` : entry
      const entryPath = dir === '/' ? entry : `${dir}/${entry}`

      try {
        const stat = await this.fs.stat(entryPath)
        if (stat.type === 'dir' && entry !== '.git') {
          files.push(...(await this.listFiles(entryPath, fullPath)))
        } else if (stat.type === 'file') {
          files.push(fullPath)
        }
      } catch (error) {
        console.warn(`Failed to stat ${entryPath}:`, error)
      }
    }

    return files
  }
}

// Factory function to create GitService
export async function createGitService(
  directoryHandle: FileSystemDirectoryHandle
): Promise<GitService> {
  return new GitService(directoryHandle)
}

// Git settings management
const SETTINGS_KEY = 'noodles-git-settings'

export function getGitSettings(): GitSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY)
    if (stored) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) }
    }
  } catch (error) {
    console.warn('Failed to load git settings:', error)
  }
  return DEFAULT_SETTINGS
}

export function saveGitSettings(settings: Partial<GitSettings>): void {
  try {
    const current = getGitSettings()
    const updated = { ...current, ...settings }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated))
  } catch (error) {
    console.warn('Failed to save git settings:', error)
  }
}
