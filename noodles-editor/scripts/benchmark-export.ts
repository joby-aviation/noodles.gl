#!/usr/bin/env tsx

// Theoretical benchmark script for export performance.
// Run with: npm run benchmark:export
//
// NOTE: This currently outputs theoretical calculations, not actual measurements.
// To measure real performance, enable debug logging in browser console:
// localStorage.debug = 'noodles:render*' and manually trigger exports.
// Future work: Add Playwright automation to trigger actual exports and parse debug logs.

// import { chromium } from 'playwright' // TODO: Uncomment when implementing real browser automation

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
  _projectPath: string,
  sceneName: string,
  captureDelay: number,
  frameCount: number = 30
): Promise<BenchmarkResult | null> {
  // TODO: Implement actual browser automation to trigger exports and measure real timing.
  // For now, this calculates theoretical performance based on the bottleneck analysis.
  // Real implementation would need to:
  // 1. Launch Playwright browser with chromium.launch()
  // 2. Navigate to the project URL
  // 3. Access window.store to set captureDelay (no require() in browser context)
  // 4. Trigger export via UI or evaluate: window.exportActions.startRender()
  // 5. Parse debug console logs for actual timing data
  // 6. Return measured results instead of calculated estimates

  const fps = 30
  const targetFrameTime = 1000 / fps
  const renderTime = 33 // actual render + encode ~33ms (from analysis)
  const totalPerFrame = captureDelay + renderTime
  const totalTime = totalPerFrame * frameCount
  const avgFrameTime = totalPerFrame
  const speedFactor = targetFrameTime / avgFrameTime

  // Theoretical timing breakdown percentages
  const waitPercent = (captureDelay / totalPerFrame) * 100
  const capturePercent = 10 // ~10% for GPU capture
  const encodePercent = 100 - waitPercent - capturePercent

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
      name: 'NYC Taxis',
      path: '/examples/nyc-taxis',
      frames: 30,
    },
    {
      name: 'World Flights',
      path: '/examples/world-flights',
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
