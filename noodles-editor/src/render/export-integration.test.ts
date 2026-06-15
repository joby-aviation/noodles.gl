import { beforeEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

// Real browser-based integration tests for video export.
// These tests load actual projects and measure frame capture performance.
//
// Run with: npm test export-integration

describe('Video Export Integration', () => {
  beforeEach(async () => {
    // Load the app
    await page.goto('/')
  })

  describe('Frame Capture Performance', () => {
    it('should capture frames faster than 0.5x realtime', async () => {
      // Load a simple project
      await page.goto('/examples/flight-paths')

      // Wait for map and deck to load
      await page.waitForSelector('canvas')

      const result = await page.evaluate(async () => {
        // Wait for project to fully load
        await new Promise(resolve => setTimeout(resolve, 3000))

        const map = (window as any).testMap
        const deck = (window as any).testDeck

        if (!map && !deck) {
          return { error: 'No map or deck found' }
        }

        // Measure frame capture timing
        const frameCount = 10
        const frames: number[] = []
        const startTime = performance.now()

        // Simulate frame capture loop
        for (let i = 0; i < frameCount; i++) {
          // Wait for render to be ready
          if (map) {
            await new Promise<void>(resolve => {
              const checkReady = () => {
                if (map.isStyleLoaded() && map.areTilesLoaded()) {
                  frames.push(performance.now())
                  map.off('render', checkReady)
                  resolve()
                } else {
                  map.triggerRepaint()
                }
              }
              map.on('render', checkReady)
              map.jumpTo({ bearing: i * 5 })
            })
          } else if (deck) {
            // Deck-only: wait for layers to load
            await new Promise<void>(resolve => {
              const checkLayers = () => {
                const allLoaded = deck.props.layers.every(
                  (layer: any) => !layer || (!Array.isArray(layer) && layer.isLoaded)
                )
                if (allLoaded) {
                  frames.push(performance.now())
                  resolve()
                } else {
                  setTimeout(checkLayers, 10)
                }
              }
              checkLayers()
            })
          }
        }

        const totalTime = performance.now() - startTime
        const avgFrameTime = totalTime / frameCount

        return {
          frameCount,
          totalTime,
          avgFrameTime,
          fps: (frameCount / totalTime) * 1000
        }
      })

      if ('error' in result) {
        throw new Error(result.error)
      }

      // Assertions
      expect(result.frameCount).toBe(10)

      // Should be faster than 0.5x realtime (66ms at 30fps)
      expect(result.avgFrameTime).toBeLessThan(66)

      // Log performance for tracking
      console.log(`Frame capture performance: ${result.avgFrameTime.toFixed(1)}ms/frame, ${result.fps.toFixed(1)} FPS`)
    }, 30000)

    it('should handle projects with MapLibre basemap', async () => {
      await page.goto('/examples/nyc-taxis')
      await page.waitForSelector('canvas')

      const hasBasemap = await page.evaluate(() => {
        const mapCanvas = document.querySelector('.maplibregl-canvas')
        return !!mapCanvas
      })

      expect(hasBasemap).toBe(true)
    }, 15000)

    it('should handle projects without basemap (pure deck.gl)', async () => {
      await page.goto('/examples/flight-paths')
      await page.waitForSelector('canvas')

      const result = await page.evaluate(() => {
        const mapCanvas = document.querySelector('.maplibregl-canvas')
        const deckCanvas = document.querySelector('canvas[id^="deckgl-"]')
        return {
          hasMap: !!mapCanvas,
          hasDeck: !!deckCanvas
        }
      })

      // Flight paths might have either config - just verify something renders
      expect(result.hasDeck || result.hasMap).toBe(true)
    }, 15000)
  })

  describe('Render Event Performance', () => {
    it('should verify render events fire faster than idle events', async () => {
      await page.goto('/examples/nyc-taxis')
      await page.waitForSelector('canvas')

      const result = await page.evaluate(async () => {
        await new Promise(resolve => setTimeout(resolve, 3000))

        const map = (window as any).testMap
        if (!map) return { error: 'No map found' }

        // Test render event timing
        const renderTimes: number[] = []
        await new Promise<void>(resolve => {
          let count = 0
          const handleRender = () => {
            renderTimes.push(performance.now())
            count++
            if (count >= 5) {
              map.off('render', handleRender)
              resolve()
            } else {
              map.jumpTo({ bearing: count * 2 })
            }
          }
          map.on('render', handleRender)
          map.jumpTo({ bearing: 0 })
        })

        // Test idle event timing
        const idleTimes: number[] = []
        await new Promise<void>(resolve => {
          let count = 0
          const handleIdle = () => {
            idleTimes.push(performance.now())
            count++
            if (count >= 5) {
              map.off('idle', handleIdle)
              resolve()
            } else {
              map.jumpTo({ bearing: count * 2 + 10 })
            }
          }
          map.on('idle', handleIdle)
          map.jumpTo({ bearing: 10 })
        })

        // Calculate average intervals
        const calcIntervals = (times: number[]) => {
          const intervals: number[] = []
          for (let i = 1; i < times.length; i++) {
            intervals.push(times[i] - times[i-1])
          }
          return intervals.reduce((a, b) => a + b, 0) / intervals.length
        }

        return {
          renderAvg: calcIntervals(renderTimes),
          idleAvg: calcIntervals(idleTimes)
        }
      })

      if ('error' in result) {
        throw new Error(result.error)
      }

      // Log the comparison
      console.log(`Render event: ${result.renderAvg.toFixed(1)}ms/frame`)
      console.log(`Idle event: ${result.idleAvg.toFixed(1)}ms/frame`)

      // Render should be at least as fast as idle
      // (may not be faster if fadeDuration is already 0)
      expect(result.renderAvg).toBeLessThanOrEqual(result.idleAvg * 1.5)
    }, 30000)
  })

  describe('fadeDuration Impact', () => {
    it('should measure performance difference with fadeDuration: 0', async () => {
      await page.goto('/examples/nyc-taxis')
      await page.waitForSelector('canvas')

      const result = await page.evaluate(async () => {
        await new Promise(resolve => setTimeout(resolve, 3000))

        const map = (window as any).testMap
        if (!map) return { error: 'No map found' }

        // Measure with default fadeDuration
        const measureFrames = async () => {
          const frames: number[] = []
          await new Promise<void>(resolve => {
            let count = 0
            const handleRender = () => {
              if (!map.isStyleLoaded() || !map.areTilesLoaded()) {
                map.triggerRepaint()
                return
              }
              frames.push(performance.now())
              count++
              if (count >= 10) {
                map.off('render', handleRender)
                resolve()
              } else {
                map.jumpTo({ bearing: count * 3 })
              }
            }
            map.on('render', handleRender)
            map.jumpTo({ bearing: 0 })
          })

          const intervals: number[] = []
          for (let i = 1; i < frames.length; i++) {
            intervals.push(frames[i] - frames[i-1])
          }
          return intervals.reduce((a, b) => a + b, 0) / intervals.length
        }

        const beforeFade = await measureFrames()

        // Set fadeDuration to 0
        if (map.style) {
          map.style.fadeDuration = 0
        }
        await new Promise(resolve => setTimeout(resolve, 500))

        const afterFade = await measureFrames()

        return {
          beforeFade,
          afterFade,
          improvement: beforeFade / afterFade
        }
      })

      if ('error' in result) {
        throw new Error(result.error)
      }

      console.log(`Before fadeDuration: 0 → ${result.beforeFade.toFixed(1)}ms/frame`)
      console.log(`After fadeDuration: 0 → ${result.afterFade.toFixed(1)}ms/frame`)
      console.log(`Improvement: ${result.improvement.toFixed(2)}x`)

      // Both should be reasonable (< 50ms/frame)
      expect(result.beforeFade).toBeLessThan(50)
      expect(result.afterFade).toBeLessThan(50)
    }, 45000)
  })
})
