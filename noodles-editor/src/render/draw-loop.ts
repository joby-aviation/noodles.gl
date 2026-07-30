import type { Deck, DeckProps } from '@deck.gl/core'
import { useEffect } from 'react'
import { debugRender } from '../utils/debug'
import { workerSetInterval, workerSetTimeout } from '../utils/worker-timer'

interface RendererConfig {
  waitForData: boolean
  captureDelay: number
}

interface UseDeckDrawLoopProps {
  deck: Deck | null
  isRendering: boolean
  // Optional callback to capture the frame, can be used when rendering a pure deck.gl scene.
  // Scenes interleaved with maplibre would use maplibre's draw callbacks.
  captureFrame?: (result?: { error?: Error }) => void
  rendererConfig: RendererConfig
  props?: Partial<DeckProps>
}

// Reduced from 16ms to 8ms with time freezing optimization.
// Time freezing eliminates skip-first-render, so we need less safety margin.
const EXPORT_FRAME_DELAY = 8

const isDeckReady = (deck: Deck | null) =>
  !deck || deck.props.layers.every(layer => !layer || (!Array.isArray(layer) && layer.isLoaded))

export function useDeckDrawLoop({
  deck,
  isRendering,
  captureFrame,
  rendererConfig,
  props = {},
}: UseDeckDrawLoopProps) {
  useEffect(() => {
    if (!isRendering || !deck) {
      return
    }

    const { waitForData } = rendererConfig

    async function drawPass() {
      try {
        let resolvePass: (value?: unknown) => void
        const passPromise = new Promise(res => {
          resolvePass = res
        })

        deck?.setProps({
          ...props,
          onAfterRender: context => {
            props.onAfterRender?.(context)
            if (waitForData && !isDeckReady(deck)) {
              debugRender('deck waiting for layers to load')
              return // layers aren't loaded
            }
            workerSetTimeout(() => resolvePass(), EXPORT_FRAME_DELAY)
          },
        })
        // Pump Deck.gl's render directly via worker timer so onAfterRender fires even when
        // the tab is switched. Deck.gl's internal RAF loop is throttled to ~1fps by Chrome
        // when a tab is hidden, so we can't rely on it to drive rendering during export.
        const cancelRedrawLoop = workerSetInterval(() => deck?.redraw('force'), 16)
        try {
          await passPromise
        } finally {
          cancelRedrawLoop()
        }
        captureFrame?.()
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e))
        console.error('[Noodles] Draw loop error:', error)
        debugRender('[useDeckDrawLoop] Error during drawing:', error)
        captureFrame?.({ error })
      }
    }

    drawPass()
  }, [deck, isRendering, captureFrame, props, rendererConfig])
}
