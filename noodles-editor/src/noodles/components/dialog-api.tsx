/**
 * Dialog API with Promise-based interface for operations.
 *
 * Operations yield dialog requests, and this API handles showing dialogs
 * and returning user responses as Promises.
 */

import { createContext, useContext, useState } from 'react'
import type {
	DialogRequest,
	SelectWorkspaceRequest,
	NameWorkspaceRequest,
	SelectProjectRequest,
	PromptNameRequest,
	ConfirmReplaceRequest,
	ConfirmDeleteRequest,
	SelectFileRequest,
	ErrorRequest,
} from '../operations/types'
import type { Workspace } from '../storage/workspace-types'

/**
 * Dialog state - which dialog is currently active and its props
 */
export type DialogState =
	| {
			type: 'workspace-picker'
			props: {
				prompt?: string
				showRecent?: boolean
				onComplete: (workspace: Workspace | null) => void
			}
	  }
	| {
			type: 'name-workspace'
			props: {
				defaultName: string
				onComplete: (name: string | null) => void
			}
	  }
	| {
			type: 'select-project'
			props: {
				workspace: Workspace
				projects: string[]
				onComplete: (projectName: string | null) => void
			}
	  }
	| {
			type: 'prompt-name'
			props: {
				defaultName?: string
				validateExists?: boolean
				onComplete: (name: string | null) => void
			}
	  }
	| {
			type: 'confirm-replace'
			props: {
				projectName: string
				onComplete: (confirmed: boolean) => void
			}
	  }
	| {
			type: 'confirm-delete'
			props: {
				projectName: string
				onComplete: (confirmed: boolean) => void
			}
	  }
	| {
			type: 'select-file'
			props: {
				accept?: string
				onComplete: (fileHandle: FileSystemFileHandle | null) => void
			}
	  }
	| {
			type: 'error'
			props: {
				message: string
				onComplete: () => void
			}
	  }
	| null

/**
 * Dialog API class that manages dialog state and returns Promises
 */
export class DialogAPI {
	private setState: (state: DialogState) => void

	constructor(setState: (state: DialogState) => void) {
		this.setState = setState
	}

	/**
	 * Show workspace picker dialog
	 */
	selectWorkspace(options?: {
		prompt?: string
		showRecent?: boolean
	}): Promise<Workspace | null> {
		return new Promise((resolve) => {
			this.setState({
				type: 'workspace-picker',
				props: {
					prompt: options?.prompt,
					showRecent: options?.showRecent,
					onComplete: resolve,
				},
			})
		})
	}

	/**
	 * Prompt user to name a workspace
	 */
	nameWorkspace(defaultName: string): Promise<string | null> {
		return new Promise((resolve) => {
			this.setState({
				type: 'name-workspace',
				props: {
					defaultName,
					onComplete: resolve,
				},
			})
		})
	}

	/**
	 * Show project list and let user select one
	 */
	selectProject(
		workspace: Workspace,
		projects: string[]
	): Promise<string | null> {
		return new Promise((resolve) => {
			this.setState({
				type: 'select-project',
				props: {
					workspace,
					projects,
					onComplete: resolve,
				},
			})
		})
	}

	/**
	 * Prompt for project name
	 */
	promptProjectName(options?: {
		defaultName?: string
		validateExists?: boolean
	}): Promise<string | null> {
		return new Promise((resolve) => {
			this.setState({
				type: 'prompt-name',
				props: {
					defaultName: options?.defaultName,
					validateExists: options?.validateExists,
					onComplete: resolve,
				},
			})
		})
	}

	/**
	 * Confirm replacing existing project
	 */
	confirmReplace(projectName: string): Promise<boolean> {
		return new Promise((resolve) => {
			this.setState({
				type: 'confirm-replace',
				props: {
					projectName,
					onComplete: resolve,
				},
			})
		})
	}

	/**
	 * Confirm deleting project
	 */
	confirmDelete(projectName: string): Promise<boolean> {
		return new Promise((resolve) => {
			this.setState({
				type: 'confirm-delete',
				props: {
					projectName,
					onComplete: resolve,
				},
			})
		})
	}

	/**
	 * Show file picker dialog
	 */
	async selectFile(accept?: string): Promise<FileSystemFileHandle | null> {
		// File System Access API doesn't use our dialog state
		// It's a browser-native dialog
		try {
			const [fileHandle] = await window.showOpenFilePicker({
				types: accept
					? [
							{
								description: 'Files',
								accept: { 'application/octet-stream': [accept] },
							},
						]
					: undefined,
			})
			return fileHandle
		} catch (err) {
			// User cancelled
			if (
				err instanceof Error &&
				(err.name === 'AbortError' || err.message.includes('user aborted'))
			) {
				return null
			}
			throw err
		}
	}

	/**
	 * Show error dialog
	 */
	showError(message: string): Promise<void> {
		return new Promise((resolve) => {
			this.setState({
				type: 'error',
				props: {
					message,
					onComplete: resolve,
				},
			})
		})
	}

	/**
	 * Execute a dialog request from an operation
	 */
	async executeDialogRequest(request: DialogRequest): Promise<any> {
		switch (request.type) {
			case 'select-workspace':
				return this.selectWorkspace({
					prompt: request.prompt,
					showRecent: request.showRecent,
				})

			case 'name-workspace':
				return this.nameWorkspace(request.defaultName)

			case 'select-project':
				return this.selectProject(request.workspace, request.projects)

			case 'prompt-name':
				return this.promptProjectName({
					defaultName: request.defaultName,
					validateExists: request.validateExists,
				})

			case 'confirm-replace':
				return this.confirmReplace(request.projectName)

			case 'confirm-delete':
				return this.confirmDelete(request.projectName)

			case 'select-file':
				return this.selectFile(request.accept)

			case 'error':
				await this.showError(request.message)
				return undefined

			default:
				throw new Error(`Unknown dialog request type: ${(request as any).type}`)
		}
	}

	/**
	 * Clear active dialog
	 */
	clearDialog(): void {
		this.setState(null)
	}
}

/**
 * React context for DialogAPI
 */
const DialogAPIContext = createContext<DialogAPI | null>(null)

/**
 * Hook to access DialogAPI
 */
export function useDialogAPI(): DialogAPI {
	const api = useContext(DialogAPIContext)
	if (!api) {
		throw new Error('useDialogAPI must be used within DialogAPIProvider')
	}
	return api
}

/**
 * Hook to access dialog state
 */
const DialogStateContext = createContext<DialogState>(null)

export function useDialogState(): DialogState {
	return useContext(DialogStateContext)
}

/**
 * Provider component that creates DialogAPI and manages dialog state
 */
export function DialogAPIProvider({ children }: { children: React.ReactNode }) {
	const [dialogState, setDialogState] = useState<DialogState>(null)
	const [dialogAPI] = useState(() => new DialogAPI(setDialogState))

	return (
		<DialogAPIContext.Provider value={dialogAPI}>
			<DialogStateContext.Provider value={dialogState}>
				{children}
			</DialogStateContext.Provider>
		</DialogAPIContext.Provider>
	)
}
