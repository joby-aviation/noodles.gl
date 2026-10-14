#!/usr/bin/env node

import { chromium } from 'playwright'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const patterns = [
  'pattern-switch-operator',
  'pattern-split-merge',
  'pattern-multi-output',
  'pattern-linear-pipeline',
  'pattern-forloop',
  'pattern-container-hierarchy'
]

const baseUrl = 'http://localhost:5173/examples/docs-patterns/'
const outputDir = join(__dirname, '../../website/static/img')

async function takeScreenshots() {
  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 }
  })
  const page = await context.newPage()

  for (const pattern of patterns) {
    console.log(`Capturing ${pattern}...`)

    await page.goto(`${baseUrl}${pattern}`)

    // Wait for page to load
    await page.waitForLoadState('networkidle')

    // Wait for the React Flow canvas to be ready
    await page.waitForSelector('.react-flow', { timeout: 10000 }).catch(() => {
      console.log(`  Warning: React Flow canvas not found for ${pattern}`)
    })

    await page.waitForTimeout(3000)

    // Check for any modals/dialogs and close them
    const modal = page.locator('[role="dialog"], .modal, [data-radix-dialog-content]').first()
    if (await modal.isVisible().catch(() => false)) {
      console.log(`  Closing modal...`)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(500)
    }

    // Take screenshot of just the viewport
    const outputPath = join(outputDir, `${pattern}.png`)
    await page.screenshot({
      path: outputPath,
      type: 'png'
    })

    console.log(`  Saved to ${outputPath}`)
  }

  await browser.close()
  console.log('All screenshots captured!')
}

takeScreenshots().catch(console.error)
