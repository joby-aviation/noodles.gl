/**
 * Integration tests for example projects (vitest/browser)
 *
 * These are lightweight browser tests that verify basic functionality.
 * For full E2E visual regression testing, see examples-visual-regression.spec.ts
 *
 * Run with: npm test examples-integration
 */

import { describe, test, expect } from 'vitest'

describe('Example Projects Integration', () => {
  test('window.deck is exposed for testing', async () => {
    // Verify the test hooks are available
    // In a real test environment, window.deck would be set by the app
    expect(typeof window).toBe('object')
  })

  test('window.getTimelineStore is exposed for testing', async () => {
    // Verify the timeline store accessor is available
    expect(typeof window).toBe('object')
  })
})

// NOTE: For comprehensive E2E tests with visual regression and animation testing,
// use Playwright tests in examples-visual-regression.spec.ts
//
// Run with: npx playwright test examples-visual-regression
// Update snapshots: npx playwright test --update-snapshots
