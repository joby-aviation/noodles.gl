import { requestPermission } from './filesystem'

// IndexedDB database configuration
const DB_NAME = 'noodles-directory-handles'
const DB_VERSION = 1
const STORE_NAME = 'handles'

// Cache entry stored in IndexedDB (serializable version)
export interface CachedHandleEntry {
  projectName: string
  handle: FileSystemDirectoryHandle
  path: string
  cachedAt: number
  lastValidated?: number
}

// DirectoryHandleCache service for managing persistent directory handles
export class DirectoryHandleCache {
  private db: IDBDatabase | null = null
  private listeners = new Set<() => void>()

  // Call `listener` after any change to the remembered projects. Returns an unsubscribe function.
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify() {
    for (const listener of this.listeners) listener()
  }

  // Initialize the IndexedDB database
  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onerror = () => reject(new Error('Failed to open IndexedDB'))

      request.onsuccess = () => {
        this.db = request.result
        resolve()
      }

      request.onupgradeneeded = event => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          // Create object store with projectName as key
          db.createObjectStore(STORE_NAME, { keyPath: 'projectName' })
        }
      }
    })
  }

  // Cache a directory handle for a project
  async cacheHandle(
    projectName: string,
    handle: FileSystemDirectoryHandle,
    path: string
  ): Promise<void> {
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite')
      const store = transaction.objectStore(STORE_NAME)

      const entry: CachedHandleEntry = {
        projectName,
        handle,
        path,
        cachedAt: Date.now(),
      }

      const request = store.put(entry)

      request.onsuccess = () => {
        resolve()
        this.notify()
      }
      request.onerror = () => reject(new Error('Failed to cache directory handle'))
    })
  }

  // Retrieve a cached directory handle
  async getCachedHandle(projectName: string): Promise<CachedHandleEntry | null> {
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.get(projectName)

      request.onsuccess = () => {
        const entry = request.result as CachedHandleEntry | undefined
        if (!entry) {
          resolve(null)
          return
        }

        resolve(entry)
      }

      request.onerror = () => reject(new Error('Failed to retrieve cached handle'))
    })
  }

  // Clear all cached handles
  async clearCache(): Promise<void> {
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.clear()

      request.onsuccess = () => {
        resolve()
        this.notify()
      }
      request.onerror = () => reject(new Error('Failed to clear cache'))
    })
  }

  // Forget a project's folder, for example from "Remove from list". The folder and its
  // files on disk are not touched.
  async removeHandle(projectName: string): Promise<void> {
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.delete(projectName)

      request.onsuccess = () => {
        resolve()
        this.notify()
      }
      request.onerror = () => reject(new Error('Failed to remove cached handle'))
    })
  }

  // Validate a directory handle and update cache if valid
  async validateHandle(projectName: string): Promise<boolean> {
    try {
      const cached = await this.getCachedHandle(projectName)
      if (!cached) return false

      // Keep the handle when access isn't granted: after a browser restart the permission
      // is back to 'prompt' and a click can grant it again. Forgetting the handle here
      // would drop the project from Recent projects.
      const hasPermission = await requestPermission(cached.handle, 'readwrite')
      if (!hasPermission) return false

      // Handle is valid, update last validated timestamp
      await this.cacheHandle(projectName, cached.handle, cached.path)
      return true
    } catch (_error) {
      // Handle is invalid (could be revoked or deleted), remove from cache
      await this.removeHandle(projectName)
      return false
    }
  }

  // Get all cached project names
  async getAllProjectNames(): Promise<string[]> {
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.getAllKeys()

      request.onsuccess = () => {
        resolve(request.result as string[])
      }

      request.onerror = () => reject(new Error('Failed to retrieve project names'))
    })
  }

  // Get all cached handles (for recent projects list)
  async getAllCachedHandles(): Promise<CachedHandleEntry[]> {
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.getAll()

      request.onsuccess = () => {
        const entries = request.result as CachedHandleEntry[]
        // Sort by most recently cached
        entries.sort((a, b) => (b.cachedAt || 0) - (a.cachedAt || 0))
        resolve(entries)
      }

      request.onerror = () => reject(new Error('Failed to retrieve cached handles'))
    })
  }

  // Point a project at a different folder, keyed by the new folder's name. Used when the
  // project is renamed (copied to a new folder) and when the user chooses a project's folder
  // again after moving or renaming it on disk. One transaction, so a failure keeps the old entry.
  async renameProject(
    oldName: string,
    newName: string,
    newHandle: FileSystemDirectoryHandle
  ): Promise<void> {
    if (!this.db) await this.init()

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      if (oldName !== newName) store.delete(oldName)
      const entry: CachedHandleEntry = {
        projectName: newName,
        handle: newHandle,
        path: newHandle.name,
        cachedAt: Date.now(),
      }
      store.put(entry)

      transaction.oncomplete = () => {
        resolve()
        this.notify()
      }
      transaction.onerror = () => reject(new Error('Failed to rename project'))
      transaction.onabort = () => reject(new Error('Failed to rename project'))
    })
  }
}

// Singleton instance
export const directoryHandleCache = new DirectoryHandleCache()
