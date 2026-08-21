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

const isDeckReady = (deck: Deck | null) => {
  if (!deck) return true

  const unloadedLayers = deck.props.layers.filter(
    layer => layer && !Array.isArray(layer) && !layer.isLoaded
  )

  if (unloadedLayers.length > 0) {
    // Check for layers in error state
    const errorLayers = unloadedLayers.filter(layer => {
      // Deck.gl layers have an internalState that tracks loading errors
      // biome-ignore lint/suspicious/noExplicitAny: accessing deck.gl internal state
      const state = (layer as any).internalState
      return state?.loadOptions?.error || state?.asyncPropLoadError
    })

    if (errorLayers.length > 0) {
      const errorDetails = errorLayers
        .map(layer => {
          // biome-ignore lint/suspicious/noExplicitAny: accessing deck.gl internal state
          const state = (layer as any).internalState
          const error = state?.loadOptions?.error || state?.asyncPropLoadError
          return `${layer.id}: ${error?.message || error}`
        })
        .join('; ')
      debugRender('deck has layers in error state (will never load): %s', errorDetails)
    }
  }

  return deck.props.layers.every(layer => !layer || (!Array.isArray(layer) && layer.isLoaded))
}

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

    const { waitForData, captureDelay } = rendererConfig

    async function drawPass() {
      try {
        let resolvePass: (value?: unknown) => void
        // biome-ignore lint/suspicious/noExplicitAny: Promise.reject accepts any error type
        let rejectPass: (reason?: any) => void
        const passPromise = new Promise((res, rej) => {
          resolvePass = res
          rejectPass = rej
        })

        // Timeout after 30 seconds to prevent infinite waiting
        const cancelTimeout = workerSetTimeout(() => {
          if (waitForData && !isDeckReady(deck)) {
            const unloadedLayers =
              deck?.props.layers.filter(
                layer => layer && !Array.isArray(layer) && !layer.isLoaded
              ) || []
            const layerInfo = unloadedLayers.map(l => `${l.id} (${l.constructor.name})`).join(', ')
            rejectPass(new Error(`Render timeout: layers did not load after 30s: ${layerInfo}`))
          }
        }, 30000)

        deck?.setProps({
          ...props,
          onAfterRender: context => {
            props.onAfterRender?.(context)
            if (waitForData && !isDeckReady(deck)) {
              debugRender('deck waiting for layers to load')
              return // layers aren't loaded
            }
            // Use worker timer so the delay fires even when the tab is hidden.
            workerSetTimeout(() => {
              cancelTimeout()
              resolvePass()
            }, captureDelay)
          },
        })
        // Pump Deck.gl's render directly via worker timer so onAfterRender fires even when
        // the tab is switched. Deck.gl's internal RAF loop is throttled to ~1fps by Chrome
        // when a tab is hidden, so we can't rely on it to drive rendering during export.
        const cancelRedrawLoop = workerSetInterval(() => deck?.redraw('force'), 16)
        try {
          await passPromise
        } finally {
          cancelTimeout()
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
