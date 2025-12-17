import type { Deck, DeckProps } from '@deck.gl/core'
import { useEffect } from 'react'

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

    const { waitForData, captureDelay } = rendererConfig

    async function drawPass() {
      try {
        let resolvePass: (value?: unknown) => void
        const passPromise = new Promise(res => {
          resolvePass = res
        })

        deck?.setProps({
          ...props,
          onAfterRender: context => {
            console.log('[onAfterRender] FIRED', {
              timestamp: performance.now(),
              deckReady: isDeckReady(deck),
              layerCount: deck?.props.layers?.length,
              layersLoaded: deck?.props.layers.filter(l => l?.isLoaded).length,
              waitForData,
              captureDelay,
            })
            props.onAfterRender?.(context)
            if (waitForData && !isDeckReady(deck)) {
              console.warn('deck waiting')
              return // layers aren't loaded
            }
            // Deck is ready, or we are not waiting for data
            // Delay rendering by 200ms so that deck and maplibre can settle before capturing.
            // In testing, this helped during interleaved rendering even though captureFrame isn't defined.
            setTimeout(() => resolvePass(), captureDelay)
          },
        })

        // Force deck to redraw when rendering video
        // This ensures onAfterRender fires even if deck thinks nothing changed.
        // During normal editing (isRendering=false), deck renders on-demand.
        if (isRendering && deck) {
          deck.redraw('frame-capture')
        }

        await passPromise
        captureFrame?.()
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e))
        console.error('[useDeckDrawLoop] Error during drawing:', error)
        captureFrame?.({ error })
      }
    }

    drawPass()
  }, [deck, isRendering, captureFrame, props, rendererConfig])
}
