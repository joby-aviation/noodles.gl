// jest-dom adds custom jest matchers for asserting on DOM nodes.
import * as matchers from '@testing-library/jest-dom/matchers'
import { afterAll, afterEach, expect, vi } from 'vitest'

expect.extend(matchers)

// Check if we're in browser mode - browser tests don't support vi.mock well
const isBrowserTest = import.meta.env.VITEST_BROWSER !== undefined

// Only set up mocks and fake timers for non-browser tests
// Note: vi.mock is hoisted and causes issues in browser mode, so we skip it entirely
if (!isBrowserTest) {
  vi.useFakeTimers({
    now: new Date('2025-02-01T00:00:00Z'),
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    vi.useRealTimers()
  })
}
