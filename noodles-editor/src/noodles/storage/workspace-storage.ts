/**
 * Workspace-aware storage API.
 *
 * Provides unified storage operations across all workspace types:
 * - folder: User-selected folders (File System Access API)
 * - browserStorage: OPFS workspace
 * - examples: Read-only public folder
 */

import type { Workspace } from './workspace-types'
import type { NoodlesProjectJSON } from '../utils/serialization'
import { safeStringify, safeParse } from '../utils/serialization'
import {
	getOPFSRoot,
	writeFileToDirectory,
	readFileFromDirectory,
	directoryExists,
} from '../utils/filesystem'

const PROJECT_FILE_NAME = 'noodles.json'
const DATA_DIRECTORY_NAME = 'data'

/**
 * List all projects in a workspace
 */
export async function listProjects(workspace: Workspace): Promise<string[]> {
	switch (workspace.type) {
		case 'folder': {
			const projects: string[] = []
			for await (const [name, handle] of workspace.handle.entries()) {
				if (handle.kind === 'directory') {
					// Check if directory contains noodles.json
					try {
						await handle.getFileHandle(PROJECT_FILE_NAME)
						projects.push(name)
					} catch {
						// Not a project directory
					}
				}
			}
			return projects
		}

		case 'browserStorage': {
			const root = await getOPFSRoot()
			const projects: string[] = []

			for await (const [name, handle] of root.entries()) {
				if (handle.kind === 'directory') {
					// Check if directory contains noodles.json
					try {
						await handle.getFileHandle(PROJECT_FILE_NAME)
						projects.push(name)
					} catch {
						// Not a project directory
					}
				}
			}
			return projects
		}

		case 'examples': {
			// Examples are static - fetch list from server
			try {
				const response = await fetch('/noodles/index.json')
				if (!response.ok) {
					return []
				}
				const index = await response.json()
				return Array.isArray(index) ? index : []
			} catch {
				// Fallback: return empty list
				return []
			}
		}
	}
}

/**
 * Load a project from a workspace
 */
export async function loadProject(
	workspace: Workspace,
	projectName: string
): Promise<NoodlesProjectJSON> {
	switch (workspace.type) {
		case 'folder': {
			const projectDir = await workspace.handle.getDirectoryHandle(projectName)
			const content = await readFileFromDirectory(projectDir, PROJECT_FILE_NAME)
			return safeParse(content)
		}

		case 'browserStorage': {
			const root = await getOPFSRoot()
			const projectDir = await root.getDirectoryHandle(projectName)
			const content = await readFileFromDirectory(projectDir, PROJECT_FILE_NAME)
			return safeParse(content)
		}

		case 'examples': {
			const response = await fetch(`/noodles/${projectName}/${PROJECT_FILE_NAME}`)
			if (!response.ok) {
				throw new Error(`Failed to load example project: ${projectName}`)
			}
			const content = await response.text()
			return safeParse(content)
		}
	}
}

/**
 * Save a project to a workspace
 */
export async function saveProject(
	workspace: Workspace,
	projectName: string,
	data: NoodlesProjectJSON
): Promise<void> {
	// Check read-only
	if (workspace.type === 'examples') {
		throw new Error('Cannot save to read-only examples workspace')
	}

	const content = safeStringify(data)

	switch (workspace.type) {
		case 'folder': {
			// Get or create project directory
			const projectDir = await workspace.handle.getDirectoryHandle(projectName, {
				create: true,
			})

			// Ensure data directory exists
			await projectDir.getDirectoryHandle(DATA_DIRECTORY_NAME, { create: true })

			// Write noodles.json
			await writeFileToDirectory(projectDir, PROJECT_FILE_NAME, content)
			break
		}

		case 'browserStorage': {
			const root = await getOPFSRoot()

			// Get or create project directory
			const projectDir = await root.getDirectoryHandle(projectName, {
				create: true,
			})

			// Ensure data directory exists
			await projectDir.getDirectoryHandle(DATA_DIRECTORY_NAME, { create: true })

			// Write noodles.json
			await writeFileToDirectory(projectDir, PROJECT_FILE_NAME, content)
			break
		}
	}
}

/**
 * Delete a project from a workspace
 */
export async function deleteProject(
	workspace: Workspace,
	projectName: string
): Promise<void> {
	// Check read-only
	if (workspace.type === 'examples') {
		throw new Error('Cannot delete from read-only examples workspace')
	}

	switch (workspace.type) {
		case 'folder': {
			await workspace.handle.removeEntry(projectName, { recursive: true })
			break
		}

		case 'browserStorage': {
			const root = await getOPFSRoot()
			await root.removeEntry(projectName, { recursive: true })
			break
		}
	}
}

/**
 * Check if a project exists in a workspace
 */
export async function projectExists(
	workspace: Workspace,
	projectName: string
): Promise<boolean> {
	const projects = await listProjects(workspace)
	return projects.includes(projectName)
}

/**
 * Get recent projects in a workspace sorted by lastModified
 */
export async function getRecentProjects(
	workspace: Workspace,
	limit = 5
): Promise<Array<{ name: string; lastModified: number }>> {
	const projectNames = await listProjects(workspace)

	// Get lastModified for each project's noodles.json
	const projectsWithTimestamps = await Promise.all(
		projectNames.map(async (name) => {
			try {
				let fileHandle: FileSystemFileHandle

				switch (workspace.type) {
					case 'folder': {
						const projectDir = await workspace.handle.getDirectoryHandle(name)
						fileHandle = await projectDir.getFileHandle(PROJECT_FILE_NAME)
						break
					}

					case 'browserStorage': {
						const root = await getOPFSRoot()
						const projectDir = await root.getDirectoryHandle(name)
						fileHandle = await projectDir.getFileHandle(PROJECT_FILE_NAME)
						break
					}

					case 'examples': {
						// Examples don't have lastModified
						return { name, lastModified: 0 }
					}
				}

				const file = await fileHandle.getFile()
				return { name, lastModified: file.lastModified }
			} catch {
				return { name, lastModified: 0 }
			}
		})
	)

	// Sort by lastModified descending and take top N
	return projectsWithTimestamps
		.sort((a, b) => b.lastModified - a.lastModified)
		.slice(0, limit)
}

/**
 * Get the data directory handle for a project
 */
export async function getDataDirectoryHandle(
	workspace: Workspace,
	projectName: string
): Promise<FileSystemDirectoryHandle | null> {
	if (workspace.type === 'examples') {
		// Examples don't have writable data directories
		return null
	}

	switch (workspace.type) {
		case 'folder': {
			const projectDir = await workspace.handle.getDirectoryHandle(projectName)
			return projectDir.getDirectoryHandle(DATA_DIRECTORY_NAME, { create: true })
		}

		case 'browserStorage': {
			const root = await getOPFSRoot()
			const projectDir = await root.getDirectoryHandle(projectName)
			return projectDir.getDirectoryHandle(DATA_DIRECTORY_NAME, { create: true })
		}
	}
}
