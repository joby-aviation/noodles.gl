# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: noodles-editor/src/__tests__/examples-visual-regression.spec.ts >> Example Projects Visual Regression >> orbit renders correctly
- Location: noodles-editor/src/__tests__/examples-visual-regression.spec.ts:59:5

# Error details

```
Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
Call log:
  - navigating to "/examples/orbit", waiting until "load"

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
> 63  |         await page.goto(`/examples/${exampleName}`)
      |                    ^ Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
  64  | 
  65  |         // Wait for Deck.gl canvas to appear
  66  |         await page.waitForSelector('canvas', { timeout: 15000 })
  67  | 
  68  |         // Check for React error boundaries
  69  |         const errorBoundary = await page.locator('[role="alert"]').count()
  70  |         expect(errorBoundary).toBe(0)
  71  | 
  72  |         // Wait for window.deck to be available (useEffect may take a moment)
  73  |         await page.waitForFunction(() => (window as any).deck !== undefined, { timeout: 10000 })
  74  | 
  75  |         // Wait for data to load - poll until layers have data
  76  |         await page.waitForFunction(
  77  |           () => {
  78  |             const deckInstance = (window as any).deck
  79  |             if (!deckInstance?.layerManager) return false
  80  | 
  81  |             const layers = deckInstance.layerManager.getLayers()
  82  |             if (layers.length === 0) return false
  83  | 
  84  |             // Check if at least one layer has loaded data
  85  |             return layers.some((layer: any) => {
  86  |               const data = layer.props.data
  87  |               if (Array.isArray(data) && data.length > 0) return true
  88  |               // Some layers use data that's not arrays (e.g., TileLayer, TerrainLayer)
  89  |               if (data && typeof data === 'object') return true
  90  |               return false
  91  |             })
  92  |           },
  93  |           { timeout: 20000 }
  94  |         )
  95  | 
  96  |         // Wait a bit more for map tiles to load
  97  |         await page.waitForTimeout(2000)
  98  | 
  99  |         // Inspect Deck.gl state to validate rendering
  100 |         const deckState = await page.evaluate(() => {
  101 |           const deckInstance = (window as any).deck
  102 |           if (!deckInstance) {
  103 |             return { error: 'Deck.gl instance not found on window.deck' }
  104 |           }
  105 | 
  106 |           const layerManager = deckInstance.layerManager
  107 |           if (!layerManager) {
  108 |             return { error: 'LayerManager not found' }
  109 |           }
  110 | 
  111 |           const layers = layerManager.getLayers()
  112 |           return {
  113 |             layerCount: layers.length,
  114 |             layers: layers.map((layer: any) => ({
  115 |               id: layer.id,
  116 |               type: layer.constructor.name,
  117 |               visible: layer.props.visible !== false,
  118 |               dataLength: Array.isArray(layer.props.data) ? layer.props.data.length : 'N/A',
  119 |               opacity: layer.props.opacity,
  120 |             })),
  121 |           }
  122 |         })
  123 | 
  124 |         // Validate Deck.gl rendered layers
  125 |         if ('error' in deckState) {
  126 |           throw new Error(`${exampleName}: ${deckState.error}`)
  127 |         }
  128 | 
  129 |         // Should have at least one layer
  130 |         expect(deckState.layerCount).toBeGreaterThan(0)
  131 | 
  132 |         // Log layer info for debugging
  133 |         console.log(`${exampleName}: ${deckState.layerCount} layers rendered`)
  134 |         for (const layer of deckState.layers) {
  135 |           console.log(
  136 |             `  - ${layer.id} (${layer.type}): ${layer.dataLength} items, visible=${layer.visible}`
  137 |           )
  138 |         }
  139 | 
  140 |         // All layers should be visible (unless explicitly hidden)
  141 |         const visibleLayers = deckState.layers.filter(l => l.visible)
  142 |         expect(visibleLayers.length).toBeGreaterThan(0)
  143 | 
  144 |         // Layers with data should have non-zero length
  145 |         const layersWithData = deckState.layers.filter(l => typeof l.dataLength === 'number')
  146 |         if (layersWithData.length > 0) {
  147 |           const hasDataInSomeLayer = layersWithData.some(l => l.dataLength > 0)
  148 |           expect(hasDataInSomeLayer).toBe(true)
  149 |         }
  150 | 
  151 |         // Take screenshot for visual regression
  152 |         const canvas = page.locator('canvas').first()
  153 |         await expect(canvas).toHaveScreenshot(`${exampleName}-initial.png`, {
  154 |           maxDiffPixels: 100, // Allow some anti-aliasing differences
  155 |         })
  156 | 
  157 |         // For animated examples, test multiple frames
  158 |         if (hasAnimation) {
  159 |           console.log(`${exampleName}: Testing animation frames (has keyframes)`)
  160 | 
  161 |           for (const time of TEST_FRAMES) {
  162 |             // Seek to specific time in timeline
  163 |             await page.evaluate((seekTime: number) => {
```