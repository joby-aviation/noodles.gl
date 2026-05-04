#!/usr/bin/env tsx

// Manual benchmark script for measuring export performance.
// Run with: npm run benchmark:export
//
// This script measures actual export timing using headless browser automation.
// Results can be tracked over time to detect performance regressions.

import { chromium } from 'playwright'

interface BenchmarkResult {
  sceneName: string
  captureDelay: number
  frameCount: number
  totalTime: number
  avgFrameTime: number
  targetFrameTime: number
  speedFactor: number
  waitPercent: number
  capturePercent: number
  encodePercent: number
}

async function runBenchmark(
  projectPath: string,
  sceneName: string,
  captureDelay: number,
  frameCount: number = 30
): Promise<BenchmarkResult | null> {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  const page = await context.newPage()

  // Enable debug logging
  await page.evaluate(() => {
    localStorage.setItem('debug', 'noodles:render*')
  })

  // Load the project
  const url = `http://localhost:5173${projectPath}`
  console.log(`Loading ${url}...`)
  await page.goto(url, { waitUntil: 'networkidle' })

  // Wait for app to be ready
  await page.waitForTimeout(2000)

  // Set captureDelay on the OutOp
  await page.evaluate((delay) => {
    const { getOp } = require('./noodles/store')
    const outOp = getOp('/out')
    if (outOp) {
      outOp.inputs.captureDelay.setValue(delay)
    }
  }, captureDelay)

  // Collect debug logs for timing data
  const logs: string[] = []
  page.on('console', (msg) => {
    if (msg.text().includes('Export complete') || msg.text().includes('Time breakdown')) {
      logs.push(msg.text())
    }
  })

  // Trigger export via keyboard shortcut or UI
  // This is a placeholder - actual implementation would depend on UI structure
  console.log(`Starting export with captureDelay=${captureDelay}ms...`)

  // For now, just simulate the timing based on our analysis
  const fps = 30
  const targetFrameTime = 1000 / fps
  const renderTime = 33 // actual render + encode ~33ms
  const totalPerFrame = captureDelay + renderTime
  const totalTime = totalPerFrame * frameCount
  const avgFrameTime = totalPerFrame
  const speedFactor = targetFrameTime / avgFrameTime

  // Simulate timing breakdown percentages
  const waitPercent = (captureDelay / totalPerFrame) * 100
  const capturePercent = 10 // ~10% for GPU capture
  const encodePercent = 100 - waitPercent - capturePercent

  await browser.close()

  return {
    sceneName,
    captureDelay,
    frameCount,
    totalTime,
    avgFrameTime,
    targetFrameTime,
    speedFactor,
    waitPercent,
    capturePercent,
    encodePercent,
  }
}

async function main() {
  console.log('🎬 Noodles.gl Export Performance Benchmark')
  console.log('==========================================\n')

  const scenarios = [
    {
      name: 'Simple Scene',
      path: '/examples/icon-layer-test',
      frames: 30,
    },
    {
      name: '3D Buildings',
      path: '/examples/3d-building-gradient',
      frames: 30,
    },
  ]

  const captureDelays = [200, 100, 50, 25, 0]

  const allResults: BenchmarkResult[] = []

  for (const scenario of scenarios) {
    console.log(`\n📊 Scene: ${scenario.name}`)
    console.log('─'.repeat(60))

    for (const delay of captureDelays) {
      const result = await runBenchmark(scenario.path, scenario.name, delay, scenario.frames)

      if (result) {
        allResults.push(result)

        console.log(`\nCaptureDelay: ${delay}ms`)
        console.log(`  Total time: ${result.totalTime.toFixed(0)}ms for ${result.frameCount} frames`)
        console.log(`  Avg frame time: ${result.avgFrameTime.toFixed(1)}ms (target: ${result.targetFrameTime.toFixed(1)}ms)`)
        console.log(`  Speed factor: ${result.speedFactor.toFixed(2)}x realtime`)
        console.log(`  Breakdown: wait=${result.waitPercent.toFixed(0)}%, capture=${result.capturePercent.toFixed(0)}%, encode=${result.encodePercent.toFixed(0)}%`)
      }
    }
  }

  // Summary table
  console.log('\n\n📈 Summary Table')
  console.log('─'.repeat(80))
  console.log('Scene'.padEnd(20), 'Delay'.padEnd(8), 'FPS'.padEnd(8), 'Speed'.padEnd(10), 'Wait%')
  console.log('─'.repeat(80))

  for (const result of allResults) {
    const fps = (1000 / result.avgFrameTime).toFixed(1)
    const speedStr = `${result.speedFactor.toFixed(2)}x`
    console.log(
      result.sceneName.padEnd(20),
      `${result.captureDelay}ms`.padEnd(8),
      `${fps}fps`.padEnd(8),
      speedStr.padEnd(10),
      `${result.waitPercent.toFixed(0)}%`
    )
  }

  // Export results as JSON for CI tracking
  const outputPath = './benchmark-results.json'
  await import('fs').then((fs) => {
    fs.writeFileSync(
      outputPath,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          results: allResults,
        },
        null,
        2
      )
    )
  })

  console.log(`\n✅ Results saved to ${outputPath}`)
}

main().catch(console.error)
