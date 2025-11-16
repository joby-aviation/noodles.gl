/**
 * Workspace cache utilities using IndexedDB.
 *
 * Stores FileSystemDirectoryHandle references for folder workspaces
 * with metadata (name, lastAccessed, cached timestamps).
 *
 * Recent workspaces and projects are computed at runtime from this cache
 * and file system metadata.
 */

import type { CachedWorkspaceEntry, Workspace } from '../storage/workspace-types'

// IndexedDB database name and version
const DB_NAME = 'noodles-workspace-cache'
const DB_VERSION = 1
const STORE_NAME = 'workspaces'

/**
 * Open IndexedDB database for workspace cache
 */
async function openDatabase(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION)

		request.onerror = () => reject(request.error)
		request.onsuccess = () => resolve(request.result)

		request.onupgradeneeded = (event) => {
			const db = (event.target as IDBOpenDBRequest).result

			// Create object store with workspace name as key
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				const store = db.createObjectStore(STORE_NAME, { keyPath: 'name' })

				// Index by lastAccessed for recent workspaces query
				store.createIndex('lastAccessed', 'lastAccessed', { unique: false })
			}
		}
	})
}

/**
 * Cache a workspace in IndexedDB
 */
export async function cacheWorkspace(
	workspace: Workspace
): Promise<void> {
	if (workspace.type !== 'folder') {
		throw new Error('Only folder workspaces can be cached')
	}

	const db = await openDatabase()

	return new Promise((resolve, reject) => {
		const transaction = db.transaction([STORE_NAME], 'readwrite')
		const store = transaction.objectStore(STORE_NAME)

		// Check if workspace already exists
		const getRequest = store.get(workspace.name)

		getRequest.onsuccess = () => {
			const existing = getRequest.result as CachedWorkspaceEntry | undefined

			const entry: CachedWorkspaceEntry = {
				name: workspace.name,
				handle: workspace.handle,
				lastAccessed: new Date(),
				cached: existing?.cached || new Date(),
			}

			const putRequest = store.put(entry)
			putRequest.onsuccess = () => resolve()
			putRequest.onerror = () => reject(putRequest.error)
		}

		getRequest.onerror = () => reject(getRequest.error)
		transaction.onerror = () => reject(transaction.error)
	})
}

/**
 * Get a cached workspace by name
 */
export async function getCachedWorkspace(
	name: string
): Promise<Workspace | null> {
	const db = await openDatabase()

	return new Promise((resolve, reject) => {
		const transaction = db.transaction([STORE_NAME], 'readonly')
		const store = transaction.objectStore(STORE_NAME)
		const request = store.get(name)

		request.onsuccess = () => {
			const entry = request.result as CachedWorkspaceEntry | undefined
			if (!entry) {
				resolve(null)
				return
			}

			// Convert to Workspace
			const workspace: Workspace = {
				type: 'folder',
				name: entry.name,
				handle: entry.handle,
			}

			resolve(workspace)
		}

		request.onerror = () => reject(request.error)
	})
}

/**
 * Get all cached workspaces sorted by lastAccessed (most recent first)
 */
export async function getRecentWorkspaces(
	limit?: number
): Promise<Workspace[]> {
	const db = await openDatabase()

	return new Promise((resolve, reject) => {
		const transaction = db.transaction([STORE_NAME], 'readonly')
		const store = transaction.objectStore(STORE_NAME)
		const index = store.index('lastAccessed')

		// Get all entries sorted by lastAccessed descending
		const request = index.openCursor(null, 'prev')
		const workspaces: Workspace[] = []

		request.onsuccess = () => {
			const cursor = request.result
			if (cursor && (!limit || workspaces.length < limit)) {
				const entry = cursor.value as CachedWorkspaceEntry

				workspaces.push({
					type: 'folder',
					name: entry.name,
					handle: entry.handle,
				})

				cursor.continue()
			} else {
				resolve(workspaces)
			}
		}

		request.onerror = () => reject(request.error)
	})
}

/**
 * Update lastAccessed timestamp for a workspace
 */
export async function updateWorkspaceAccess(name: string): Promise<void> {
	const db = await openDatabase()

	return new Promise((resolve, reject) => {
		const transaction = db.transaction([STORE_NAME], 'readwrite')
		const store = transaction.objectStore(STORE_NAME)
		const getRequest = store.get(name)

		getRequest.onsuccess = () => {
			const entry = getRequest.result as CachedWorkspaceEntry | undefined
			if (!entry) {
				reject(new Error(`Workspace not found: ${name}`))
				return
			}

			entry.lastAccessed = new Date()

			const putRequest = store.put(entry)
			putRequest.onsuccess = () => resolve()
			putRequest.onerror = () => reject(putRequest.error)
		}

		getRequest.onerror = () => reject(getRequest.error)
	})
}

/**
 * Remove a workspace from cache
 */
export async function removeCachedWorkspace(name: string): Promise<void> {
	const db = await openDatabase()

	return new Promise((resolve, reject) => {
		const transaction = db.transaction([STORE_NAME], 'readwrite')
		const store = transaction.objectStore(STORE_NAME)
		const request = store.delete(name)

		request.onsuccess = () => resolve()
		request.onerror = () => reject(request.error)
	})
}

/**
 * Check if a workspace is cached
 */
export async function isWorkspaceCached(name: string): Promise<boolean> {
	const workspace = await getCachedWorkspace(name)
	return workspace !== null
}

/**
 * Clear all cached workspaces
 */
export async function clearWorkspaceCache(): Promise<void> {
	const db = await openDatabase()

	return new Promise((resolve, reject) => {
		const transaction = db.transaction([STORE_NAME], 'readwrite')
		const store = transaction.objectStore(STORE_NAME)
		const request = store.clear()

		request.onsuccess = () => resolve()
		request.onerror = () => reject(request.error)
	})
}

/**
 * Get count of cached workspaces
 */
export async function getCachedWorkspaceCount(): Promise<number> {
	const db = await openDatabase()

	return new Promise((resolve, reject) => {
		const transaction = db.transaction([STORE_NAME], 'readonly')
		const store = transaction.objectStore(STORE_NAME)
		const request = store.count()

		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error)
	})
}
