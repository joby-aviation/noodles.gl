import type { Deck, DeckProps } from '@deck.gl/core'
import { useEffect } from 'react'
import { debugRender } from '../utils/debug'
import { workerSetTimeout } from '../utils/worker-timer'

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
              debugRender('deck waiting for layers to load')
              return // layers aren't loaded
            }
            // Use worker timer so the delay fires even when the tab is hidden.
            workerSetTimeout(() => resolvePass(), captureDelay)
          },
        })
        await passPromise
        captureFrame?.()
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e))
        debugRender('[useDeckDrawLoop] Error during drawing:', error)
        captureFrame?.({ error })
      }
    }

    drawPass()
  }, [deck, isRendering, captureFrame, props, rendererConfig])
}
