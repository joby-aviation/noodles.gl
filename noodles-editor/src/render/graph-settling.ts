// Utilities for detecting when the reactive operator graph has settled
// after a timeline update. Used during video rendering to ensure all
// operators have finished executing before capturing frames.

import { getAllOps } from '../noodles/store'

export interface GraphSettlingOptions {
	// Maximum time to wait in milliseconds. Default: 5000
	timeout?: number
	// How often to check operator states in milliseconds. Default: 10
	pollInterval?: number
}

// Wait for all operators in the reactive graph to finish executing.
//
// An operator is considered "executing" if its executionState.status === 'executing'.
// The graph is "settled" when no operators are executing.
//
// This is critical for video frame capture to ensure data changes have fully
// propagated through the reactive graph before rendering frames.
//
// Throws Error if timeout is reached before graph settles
export async function waitForGraphSettled(
	options: GraphSettlingOptions = {},
): Promise<void> {
	const { timeout = 5000, pollInterval = 10 } = options
	const startTime = performance.now()

	while (true) {
		const elapsed = performance.now() - startTime

		if (elapsed >= timeout) {
			// Timeout reached - report which operators are stuck
			const stillExecuting = getAllOps()
				.filter((op) => op.executionState.value.status === 'executing')
				.map((op) => `${op.id} (${op.constructor.displayName})`)

			throw new Error(
				`Graph did not settle within ${timeout}ms. ` +
					`Operators still executing: ${stillExecuting.join(', ')}`,
			)
		}

		// Check if any operators are currently executing
		const allOps = getAllOps()
		const executingOps = allOps.filter(
			(op) => op.executionState.value.status === 'executing',
		)

		if (executingOps.length === 0) {
			// Graph has settled - all operators idle, success, or error
			return
		}

		// Wait before checking again
		await new Promise((resolve) => setTimeout(resolve, pollInterval))
	}
}

// Get current graph execution statistics.
// Useful for debugging and monitoring during development.
export function getGraphStats() {
	const allOps = getAllOps()
	const stats = {
		total: allOps.length,
		idle: 0,
		executing: 0,
		success: 0,
		error: 0,
	}

	for (const op of allOps) {
		const status = op.executionState.value.status
		stats[status]++
	}

	return stats
}
