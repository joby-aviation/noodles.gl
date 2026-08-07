// jest-dom adds custom jest matchers for asserting on DOM nodes.
import * as matchers from '@testing-library/jest-dom/matchers'
import { afterAll, afterEach, expect, vi } from 'vitest'

expect.extend(matchers)

// Vitest runs setup files before test modules, so imports observe this frozen clock.
vi.useFakeTimers({
  now: new Date('2025-02-01T00:00:00Z'),
})

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(async () => {
  vi.useRealTimers()
})
