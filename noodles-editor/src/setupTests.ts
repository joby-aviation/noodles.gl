// jest-dom adds custom jest matchers for asserting on DOM nodes.
import * as matchers from '@testing-library/jest-dom/matchers'
import { afterAll, afterEach, expect, vi } from 'vitest'

expect.extend(matchers)

vi.useFakeTimers({
  now: new Date('2025-02-01T00:00:00Z'),
})

// Fields depends on a global Date object, so we need to mock
// it, but imports are tricky so we need to use vi.mock to ensure
// the import runs after the fake timers are set up.
vi.mock(import('./noodles/fields'), async importOriginal => {
  return await importOriginal()
})

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(async () => {
  vi.useRealTimers()
})
