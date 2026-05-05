#!/usr/bin/env node

// Validates benchmark results against performance thresholds.
// Run with: node scripts/check-benchmark-thresholds.js
//
// Reads benchmark-results.json and checks if performance meets minimum requirements.
// Exits with code 1 if any threshold is violated (fails CI build).

import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Performance thresholds based on the 8.6x optimization
const THRESHOLDS = {
  // Frame capture time must be < 50ms per frame (allows headroom from 36ms measured)
  maxFrameTime: 50,

  // Total export time for 30 frames must be < 2 seconds
  maxTotalTimeFor30Frames: 2000,

  // Speed factor must be at least 0.5x realtime (target is 0.93x)
  minSpeedFactor: 0.5,

  // Speedup vs old approach must be at least 6x (conservative vs 8.6x measured)
  minSpeedupVsOld: 6.0,

  // Reference values from old approach (for speedup comparison)
  oldApproachFrameTime: 308, // ms per frame
}

function checkThresholds(results) {
  const errors = []
  const warnings = []

  console.log('🔍 Checking performance thresholds...\n')

  for (const result of results) {
    const {
      sceneName,
      captureDelay,
      avgFrameTime,
      speedFactor,
      frameCount,
      totalTime,
    } = result

    console.log(`Scene: ${sceneName} (captureDelay: ${captureDelay}ms)`)

    // Check 1: Frame time threshold
    if (avgFrameTime > THRESHOLDS.maxFrameTime) {
      errors.push(
        `  ❌ Frame time ${avgFrameTime.toFixed(1)}ms exceeds maximum ${THRESHOLDS.maxFrameTime}ms`
      )
    } else {
      console.log(
        `  ✅ Frame time: ${avgFrameTime.toFixed(1)}ms (max: ${THRESHOLDS.maxFrameTime}ms)`
      )
    }

    // Check 2: Total time threshold (for 30 frame exports)
    if (frameCount === 30 && totalTime > THRESHOLDS.maxTotalTimeFor30Frames) {
      errors.push(
        `  ❌ Total time ${totalTime.toFixed(0)}ms exceeds maximum ${THRESHOLDS.maxTotalTimeFor30Frames}ms for 30 frames`
      )
    } else if (frameCount === 30) {
      console.log(
        `  ✅ Total time: ${totalTime.toFixed(0)}ms (max: ${THRESHOLDS.maxTotalTimeFor30Frames}ms)`
      )
    }

    // Check 3: Speed factor threshold
    if (speedFactor < THRESHOLDS.minSpeedFactor) {
      errors.push(
        `  ❌ Speed factor ${speedFactor.toFixed(2)}x below minimum ${THRESHOLDS.minSpeedFactor}x realtime`
      )
    } else {
      console.log(
        `  ✅ Speed factor: ${speedFactor.toFixed(2)}x (min: ${THRESHOLDS.minSpeedFactor}x)`
      )
    }

    // Check 4: Speedup vs old approach
    const speedupVsOld = THRESHOLDS.oldApproachFrameTime / avgFrameTime
    if (speedupVsOld < THRESHOLDS.minSpeedupVsOld) {
      warnings.push(
        `  ⚠️  Speedup ${speedupVsOld.toFixed(1)}x below target ${THRESHOLDS.minSpeedupVsOld}x (vs old 308ms baseline)`
      )
    } else {
      console.log(
        `  ✅ Speedup vs old: ${speedupVsOld.toFixed(1)}x (min: ${THRESHOLDS.minSpeedupVsOld}x)`
      )
    }

    console.log('')
  }

  return { errors, warnings }
}

function main() {
  const resultsPath = join(__dirname, '..', 'benchmark-results.json')

  console.log('📊 Noodles.gl Benchmark Threshold Checker')
  console.log('==========================================\n')

  // Check if results file exists
  if (!existsSync(resultsPath)) {
    console.error(`❌ Error: benchmark-results.json not found at ${resultsPath}`)
    console.error(
      '\nRun benchmarks first with: npm run benchmark:export\n'
    )
    process.exit(1)
  }

  // Read and parse results
  let data
  try {
    const content = readFileSync(resultsPath, 'utf8')
    data = JSON.parse(content)
  } catch (error) {
    console.error(`❌ Error reading benchmark results: ${error.message}`)
    process.exit(1)
  }

  if (!data.results || !Array.isArray(data.results)) {
    console.error('❌ Error: Invalid benchmark results format')
    process.exit(1)
  }

  console.log(`Timestamp: ${data.timestamp}`)
  console.log(`Results: ${data.results.length} benchmark(s)\n`)

  // Check thresholds
  const { errors, warnings } = checkThresholds(data.results)

  // Print summary
  console.log('─'.repeat(60))
  console.log('\n📋 Summary\n')

  if (errors.length > 0) {
    console.log('❌ FAILURES:\n')
    errors.forEach((error) => console.log(error))
    console.log('')
  }

  if (warnings.length > 0) {
    console.log('⚠️  WARNINGS:\n')
    warnings.forEach((warning) => console.log(warning))
    console.log('')
  }

  if (errors.length === 0 && warnings.length === 0) {
    console.log('✅ All performance thresholds met!')
    console.log(
      '\nThe render event optimization is working correctly and'
    )
    console.log('performance has not regressed below acceptable levels.')
  }

  // Exit with error code if any thresholds failed
  if (errors.length > 0) {
    console.log(
      '\n❌ Performance regression detected! Fix issues above before merging.\n'
    )
    process.exit(1)
  }

  console.log('')
  process.exit(0)
}

main()
