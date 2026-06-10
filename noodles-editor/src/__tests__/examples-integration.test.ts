/**
 * Integration tests for example projects (vitest/browser)
 *
 * Simple smoke tests that run in browser mode.
 * For comprehensive E2E tests, see examples-visual-regression.spec.ts
 *
 * Run with: npm test examples-integration
 */

import { describe, test, expect } from 'vitest'

describe('Example Projects Integration', () => {
  test('test environment is set up correctly', () => {
    // Verify we're running in a browser environment
    expect(typeof window).toBe('object')
    expect(typeof document).toBe('object')
    expect(typeof navigator).toBe('object')
  })

  test('required globals are available', () => {
    // These would be set by the app when it loads
    // This test just verifies the test environment itself works
    expect(window.location).toBeDefined()
    expect(document.querySelector).toBeDefined()
  })
})

// NOTE: For real E2E testing that loads examples, validates rendering,
// and performs visual regression, use the Playwright tests:
//
// Run single example:
//   npx playwright test examples-visual-regression -g "nyc-taxis"
//
// Run all examples:
//   npx playwright test examples-visual-regression
//
// Update screenshots:
//   npx playwright test examples-visual-regression --update-snapshots
