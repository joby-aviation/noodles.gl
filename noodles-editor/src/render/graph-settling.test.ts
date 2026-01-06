import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BehaviorSubject } from 'rxjs'
import { getGraphStats, waitForGraphSettled } from './graph-settling'
import * as store from '../noodles/store'

// Mock the store
vi.mock('../noodles/store', () => ({
	getAllOps: vi.fn(),
}))

describe('waitForGraphSettled', () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.restoreAllMocks()
		vi.useRealTimers()
	})

	it('resolves immediately if no operators exist', async () => {
		;(store.getAllOps as Mock).mockReturnValue([])

		const promise = waitForGraphSettled({ timeout: 100 })
		await vi.advanceTimersByTimeAsync(0)

		await expect(promise).resolves.toBeUndefined()
	})

	it('resolves immediately if all operators are idle', async () => {
		const mockOps = [
			{
				id: '/op1',
				constructor: { displayName: 'TestOp1' },
				executionState: new BehaviorSubject({ status: 'idle' }),
			},
			{
				id: '/op2',
				constructor: { displayName: 'TestOp2' },
				executionState: new BehaviorSubject({
					status: 'success',
					lastExecuted: new Date(),
					executionTime: 10,
				}),
			},
		]
		;(store.getAllOps as Mock).mockReturnValue(mockOps)

		const promise = waitForGraphSettled({ timeout: 100 })
		await vi.advanceTimersByTimeAsync(0)

		await expect(promise).resolves.toBeUndefined()
	})

	it('waits for executing operators to complete', async () => {
		const executionState = new BehaviorSubject({ status: 'executing' as const })
		const mockOp = {
			id: '/op1',
			constructor: { displayName: 'TestOp1' },
			executionState,
		}
		;(store.getAllOps as Mock).mockReturnValue([mockOp])

		const promise = waitForGraphSettled({ timeout: 1000, pollInterval: 10 })

		// After 50ms, transition to success
		setTimeout(() => {
			executionState.next({
				status: 'success',
				lastExecuted: new Date(),
				executionTime: 50,
			})
		}, 50)

		await vi.advanceTimersByTimeAsync(60)
		await expect(promise).resolves.toBeUndefined()
	})

	it('throws timeout error if operators never complete', async () => {
		const mockOp = {
			id: '/stuck-op',
			constructor: { displayName: 'StuckOp' },
			executionState: new BehaviorSubject({ status: 'executing' as const }),
		}
		;(store.getAllOps as Mock).mockReturnValue([mockOp])

		const promise = waitForGraphSettled({ timeout: 100, pollInterval: 10 })

		// Advance timers past timeout
		vi.advanceTimersByTime(101)

		// Wait for the promise to reject and verify error message contains expected strings
		try {
			await promise
			expect.fail('Should have thrown timeout error')
		} catch (error) {
			expect(error).toBeInstanceOf(Error)
			expect((error as Error).message).toMatch(/Graph did not settle within 100ms/)
			expect((error as Error).message).toMatch(/stuck-op/)
		}
	})

	it('ignores operators in error state', async () => {
		const mockOps = [
			{
				id: '/op1',
				constructor: { displayName: 'TestOp1' },
				executionState: new BehaviorSubject({
					status: 'error' as const,
					error: 'Test error',
					lastExecuted: new Date(),
					executionTime: 10,
				}),
			},
			{
				id: '/op2',
				constructor: { displayName: 'TestOp2' },
				executionState: new BehaviorSubject({ status: 'idle' as const }),
			},
		]
		;(store.getAllOps as Mock).mockReturnValue(mockOps)

		const promise = waitForGraphSettled({ timeout: 100 })
		await vi.advanceTimersByTimeAsync(0)

		await expect(promise).resolves.toBeUndefined()
	})
})

describe('getGraphStats', () => {
	it('returns correct statistics', () => {
		const mockOps = [
			{
				executionState: new BehaviorSubject({ status: 'idle' as const }),
			},
			{
				executionState: new BehaviorSubject({ status: 'executing' as const }),
			},
			{
				executionState: new BehaviorSubject({
					status: 'success' as const,
					lastExecuted: new Date(),
					executionTime: 10,
				}),
			},
			{
				executionState: new BehaviorSubject({
					status: 'error' as const,
					error: 'Test error',
					lastExecuted: new Date(),
					executionTime: 10,
				}),
			},
		]
		;(store.getAllOps as Mock).mockReturnValue(mockOps)

		const stats = getGraphStats()
		expect(stats).toEqual({
			total: 4,
			idle: 1,
			executing: 1,
			success: 1,
			error: 1,
		})
	})
})
