/**
 * Operation runner for async generator operations.
 *
 * Executes operations by:
 * 1. Advancing the generator
 * 2. Yielding dialog requests to DialogAPI
 * 3. Passing dialog results back to generator
 * 4. Handling errors and cancellation
 */

import type { DialogAPI } from '../components/dialog-api'
import type { Operation, DialogRequest } from '../operations/types'
import { CancellationError } from '../operations/types'

/**
 * Options for running an operation
 */
export interface RunOperationOptions {
	/**
	 * Optional callback for operation progress/state updates
	 */
	onProgress?: (message: string) => void

	/**
	 * Optional error handler
	 */
	onError?: (error: Error) => void

	/**
	 * Optional cancellation handler
	 */
	onCancel?: () => void

	/**
	 * Optional success handler
	 */
	onSuccess?: (result: any) => void
}

/**
 * Run an async generator operation
 *
 * @param generator - The async generator to execute
 * @param dialogAPI - Dialog API for showing dialogs
 * @param options - Optional callbacks for progress, errors, etc.
 * @returns Promise that resolves with the operation's return value
 */
export async function runOperation<T>(
	generator: Operation<T>,
	dialogAPI: DialogAPI,
	options: RunOperationOptions = {}
): Promise<T> {
	const { onProgress, onError, onCancel, onSuccess } = options

	let lastResult: any = undefined

	try {
		while (true) {
			// Advance the generator
			const { value, done } = await generator.next(lastResult)

			// If generator is done, return final value
			if (done) {
				const result = value as T
				onSuccess?.(result)
				return result
			}

			// Value is a DialogRequest - execute it
			const dialogRequest = value as DialogRequest

			// Optional progress notification
			if (onProgress) {
				const progressMessage = getProgressMessage(dialogRequest)
				if (progressMessage) {
					onProgress(progressMessage)
				}
			}

			// Execute the dialog request and get user response
			try {
				lastResult = await dialogAPI.executeDialogRequest(dialogRequest)
			} catch (err) {
				// Dialog execution failed
				if (err instanceof CancellationError) {
					// User cancelled - abort operation
					await generator.return(undefined as T)
					onCancel?.()
					throw err
				}
				throw err
			}

			// Check if user cancelled
			if (lastResult === null && isCancellableDialog(dialogRequest)) {
				// User cancelled dialog - abort operation
				await generator.return(undefined as T)
				const cancelError = new CancellationError()
				onCancel?.()
				throw cancelError
			}
		}
	} catch (error) {
		// Operation threw an error
		if (error instanceof CancellationError) {
			// Already handled above
			throw error
		}

		// Other error
		onError?.(error as Error)
		throw error
	} finally {
		// Clean up any active dialogs
		dialogAPI.clearDialog()
	}
}

/**
 * Check if a dialog request can be cancelled by the user
 */
function isCancellableDialog(request: DialogRequest): boolean {
	// Error dialogs are not cancellable - they're informational
	return request.type !== 'error'
}

/**
 * Get a progress message for a dialog request (for debugging/logging)
 */
function getProgressMessage(request: DialogRequest): string | null {
	switch (request.type) {
		case 'select-workspace':
			return 'Waiting for workspace selection...'
		case 'name-workspace':
			return 'Waiting for workspace name...'
		case 'select-project':
			return 'Waiting for project selection...'
		case 'prompt-name':
			return 'Waiting for project name...'
		case 'confirm-replace':
			return `Confirming project replacement...`
		case 'confirm-delete':
			return `Confirming project deletion...`
		case 'select-file':
			return 'Waiting for file selection...'
		case 'error':
			return `Error: ${request.message}`
		default:
			return null
	}
}

/**
 * Helper to create an operation runner bound to a DialogAPI instance
 */
export function createOperationRunner(dialogAPI: DialogAPI) {
	return <T>(
		generator: Operation<T>,
		options?: RunOperationOptions
	): Promise<T> => {
		return runOperation(generator, dialogAPI, options)
	}
}
