# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: noodles-editor/src/__tests__/examples-visual-regression.spec.ts >> Example Projects Visual Regression >> orbit renders correctly
- Location: noodles-editor/src/__tests__/examples-visual-regression.spec.ts:59:5

# Error details

```
Error: Channel closed
```

```
Error: page.goto: Target page, context or browser has been closed
Call log:
  - navigating to "/examples/orbit", waiting until "networkidle"

```

# Test source

```ts
  1   | /**
  2   |  * Visual Regression Tests for Example Projects
  3   |  *
  4   |  * These are true E2E tests using Playwright that:
  5   |  * - Dynamically discover all examples from the filesystem
  6   |  * - Navigate to each example
  7   |  * - Wait for data to load
  8   |  * - Validate Deck.gl rendering
  9   |  * - Take screenshots for visual regression
  10  |  * - Test animation frames for examples with keyframes
  11  |  *
  12  |  * Run with: npx playwright test examples-visual-regression
  13  |  * Update snapshots: npx playwright test examples-visual-regression --update-snapshots
  14  |  */
  15  | 
  16  | import { test, expect } from '@playwright/test'
  17  | import { readdirSync, readFileSync, existsSync } from 'fs'
  18  | import { join, dirname } from 'path'
  19  | import { fileURLToPath } from 'url'
  20  | 
  21  | // Test frames for animated examples (in seconds)
  22  | const TEST_FRAMES = [0, 0.5, 1.0, 2.0]
  23  | 
  24  | // Discover all examples from the filesystem
  25  | const __filename = fileURLToPath(import.meta.url)
  26  | const __dirname = dirname(__filename)
  27  | const examplesDir = join(__dirname, '../examples')
  28  | const EXAMPLES = readdirSync(examplesDir).filter(name => {
  29  |   const noodlesPath = join(examplesDir, name, 'noodles.json')
  30  |   return existsSync(noodlesPath)
  31  | })
  32  | 
  33  | // Check if an example is animated by looking for keyframes in the project file
  34  | function isAnimated(exampleName: string): boolean {
  35  |   try {
  36  |     const noodlesPath = join(examplesDir, exampleName, 'noodles.json')
  37  |     const content = readFileSync(noodlesPath, 'utf-8')
  38  |     const project = JSON.parse(content)
  39  | 
  40  |     // Check if any nodes have keyframes
  41  |     if (project.nodes) {
  42  |       for (const node of project.nodes) {
  43  |         if (node.data?.keyframes && Object.keys(node.data.keyframes).length > 0) {
  44  |           return true
  45  |         }
  46  |       }
  47  |     }
  48  | 
  49  |     return false
  50  |   } catch {
  51  |     return false
  52  |   }
  53  | }
  54  | 
  55  | test.describe('Example Projects Visual Regression', () => {
  56  |   for (const exampleName of EXAMPLES) {
  57  |     const hasAnimation = isAnimated(exampleName)
  58  | 
  59  |     test(
  60  |       `${exampleName} renders correctly`,
  61  |       async ({ page }) => {
  62  |         // Navigate to the example
> 63  |         await page.goto(`/examples/${exampleName}`, { waitUntil: 'networkidle' })
      |                    ^ Error: page.goto: Target page, context or browser has been closed
  64  | 
  65  |         // Wait for window.deck to be available and canvas to render
  66  |         await page.waitForFunction(() => {
  67  |           const canvas = document.querySelector('canvas')
  68  |           const deck = (window as any).deck
  69  |           return canvas !== null && deck !== undefined
  70  |         }, { timeout: 30000 })
  71  | 
  72  |         // Wait for data to load and render
  73  |         // TODO: Hook into actual data loading state instead of fixed timeout
  74  |         // For now, use a generous timeout to handle slow external data
  75  |         await page.waitForTimeout(10000)
  76  | 
  77  |         // Take screenshot for visual regression
  78  |         // Captures the full React Flow viewport including both:
  79  |         // - The Deck.gl canvas (visualization output)
  80  |         // - The React Flow nodes (node editor UI)
  81  |         const reactFlowWrapper = page.locator('.react-flow-wrapper').first()
  82  |         await expect(reactFlowWrapper).toHaveScreenshot(`${exampleName}.png`, {
  83  |           maxDiffPixels: 100, // Allow some anti-aliasing differences
  84  |         })
  85  | 
  86  |         // For animated examples, test multiple frames
  87  |         if (hasAnimation) {
  88  |           console.log(`${exampleName}: Testing animation frames (has keyframes)`)
  89  | 
  90  |           for (const time of TEST_FRAMES) {
  91  |             // Seek to specific time in timeline
  92  |             await page.evaluate((seekTime: number) => {
  93  |               const getTimelineStore = (window as any).getTimelineStore
  94  |               if (getTimelineStore) {
  95  |                 const store = getTimelineStore()
  96  |                 store.setPosition(seekTime)
  97  |               }
  98  |             }, time)
  99  | 
  100 |             // Wait for render
  101 |             await page.waitForTimeout(500)
  102 | 
  103 |             // Take screenshot at this frame
  104 |             const reactFlowWrapper = page.locator('.react-flow-wrapper').first()
  105 |             await expect(reactFlowWrapper).toHaveScreenshot(`${exampleName}-${time}s.png`, {
  106 |               maxDiffPixels: 100,
  107 |             })
  108 |           }
  109 |         }
  110 |       },
  111 |       { timeout: 150000 }
  112 |     ) // 150 second (2.5 min) timeout for slow data loading
  113 |   }
  114 | })
  115 | 
```