/**
 * Integration tests for example projects
 *
 * Tests that all example projects load without errors in the browser.
 * These are real browser tests using Playwright to catch:
 * - JSON parsing errors
 * - Missing operators
 * - Invalid connections
 * - Deck.gl initialization errors
 * - React errors during render
 */

import { describe, test, expect } from 'vitest'
import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const examplesDir = join(__dirname, '../examples')

describe('Example Projects Integration', () => {
  // Get all example directories that have noodles.json
  const examples = readdirSync(examplesDir).filter(name => {
    const noodlesPath = join(examplesDir, name, 'noodles.json')
    return existsSync(noodlesPath)
  })

  for (const exampleName of examples) {
    test(`${exampleName} loads without errors`, async ({ page }) => {
      // Track console errors
      const errors: string[] = []
      const warnings: string[] = []

      page.on('console', msg => {
        if (msg.type() === 'error') {
          errors.push(msg.text())
        } else if (msg.type() === 'warning' && msg.text().includes('Deck.gl')) {
          warnings.push(msg.text())
        }
      })

      // Track unhandled exceptions
      page.on('pageerror', error => {
        errors.push(`Uncaught exception: ${error.message}`)
      })

      // Load the example
      const url = `http://localhost:5173/examples/${exampleName}`
      const response = await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: 30000,
      })

      // Check HTTP response
      expect(response?.status()).toBe(200)

      // Wait for Deck.gl to initialize
      await page.waitForSelector('canvas', { timeout: 10000 })

      // Check for React error boundaries
      const errorBoundary = await page.locator('[role="alert"]').count()
      expect(errorBoundary).toBe(0)

      // Give it a moment to render
      await page.waitForTimeout(2000)

      // Check for critical errors (filter out expected warnings)
      const criticalErrors = errors.filter(err => {
        // Filter out expected warnings
        if (err.includes('DevTools')) return false
        if (err.includes('sourcemap')) return false
        if (err.includes('favicon')) return false
        return true
      })

      if (criticalErrors.length > 0) {
        console.error(`Errors in ${exampleName}:`, criticalErrors)
      }

      expect(criticalErrors).toHaveLength(0)

      // Check for Deck.gl-specific warnings
      const deckWarnings = warnings.filter(warn => {
        if (warn.includes('deprecated')) return false
        return true
      })

      if (deckWarnings.length > 0) {
        console.warn(`Deck.gl warnings in ${exampleName}:`, deckWarnings)
      }

      // Deck.gl warnings don't fail the test, but we log them
    }, 60000) // 60 second timeout per test
  }

  test('at least one example is tested', () => {
    expect(examples.length).toBeGreaterThan(0)
  })
})
