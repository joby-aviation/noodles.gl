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
