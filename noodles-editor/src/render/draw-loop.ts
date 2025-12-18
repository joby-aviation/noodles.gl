import type { Deck, DeckProps } from '@deck.gl/core'
import { useEffect, useRef } from 'react'

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
  // Use refs to maintain state across renders without causing re-runs
  const resolvePassRef = useRef<((value?: unknown) => void) | null>(null)
  const captureFrameRef = useRef(captureFrame)

  // Keep captureFrame ref up to date
  useEffect(() => {
    captureFrameRef.current = captureFrame
  }, [captureFrame])

  // Store the latest props and rendererConfig in refs to avoid re-running effect
  const propsRef = useRef(props)
  const rendererConfigRef = useRef(rendererConfig)

  useEffect(() => {
    propsRef.current = props
  }, [props])

  useEffect(() => {
    rendererConfigRef.current = rendererConfig
  }, [rendererConfig])

  // Apply our onAfterRender wrapper every time props change
  // This ensures it doesn't get overwritten by the DeckGL component
  useEffect(() => {
    if (!isRendering || !deck) {
      return
    }

    console.log('[useDeckDrawLoop] Applying onAfterRender wrapper')

    // Wrap the incoming onAfterRender to add our frame capture logic
    const wrappedOnAfterRender = (context: any) => {
      const { waitForData, captureDelay } = rendererConfigRef.current
      const currentProps = propsRef.current

      console.log('[onAfterRender] FIRED', {
        timestamp: performance.now(),
        deckReady: isDeckReady(deck),
        layerCount: deck?.props.layers?.length,
        layersLoaded: deck?.props.layers.filter((l: any) => l && !Array.isArray(l) && l.isLoaded).length,
        waitForData,
        captureDelay,
        hasResolver: !!resolvePassRef.current,
      })

      // Call original onAfterRender if it exists
      currentProps.onAfterRender?.(context)

      // Only resolve if we have a pending frame request
      if (!resolvePassRef.current) {
        console.log('[onAfterRender] No pending frame request, ignoring')
        return
      }

      if (waitForData && !isDeckReady(deck)) {
        console.warn('[onAfterRender] Deck not ready, waiting for layers to load')
        return // layers aren't loaded yet
      }

      // Deck is ready - resolve after captureDelay
      const resolver = resolvePassRef.current
      setTimeout(() => {
        console.log('[onAfterRender] Resolving frame capture after delay')
        resolver()
        resolvePassRef.current = null
      }, captureDelay)
    }

    // Apply all incoming props PLUS our wrapped onAfterRender
    // This runs every time props change, ensuring our callback isn't overwritten
    deck.setProps({
      ...props,
      onAfterRender: wrappedOnAfterRender
    })
  }, [deck, isRendering, props, rendererConfig])

  // This effect continuously waits for frames and triggers redraws
  useEffect(() => {
    if (!isRendering || !deck) {
      return
    }

    let isActive = true

    // Continuously wait for frames
    // We call deck.redraw() ourselves to ensure it happens AFTER all setProps calls
    const frameLoop = async () => {
      while (isActive) {
        try {
          console.log('[useDeckDrawLoop] Ready for next frame...')

          // Set up promise for this frame
          const passPromise = new Promise(res => {
            resolvePassRef.current = res
          })

          // Small delay to let any pending setProps calls complete
          // This ensures deck.redraw() happens AFTER setProps, not before
          await new Promise(resolve => setTimeout(resolve, 0))

          // Now trigger the redraw - this will call onAfterRender
          console.log('[useDeckDrawLoop] Calling deck.redraw()')
          deck.redraw('frame-capture')

          // Wait for onAfterRender to resolve
          await passPromise
          console.log('[useDeckDrawLoop] Frame captured, calling captureFrame callback')
          captureFrameRef.current?.()
        } catch (e) {
          const error = e instanceof Error ? e : new Error(String(e))
          console.error('[useDeckDrawLoop] Error during frame capture:', error)
          captureFrameRef.current?.({ error })
          resolvePassRef.current = null
          break
        }
      }
    }

    // Start the continuous frame loop
    frameLoop()

    // Cleanup: stop the loop when component unmounts or rendering stops
    return () => {
      isActive = false
      if (resolvePassRef.current) {
        resolvePassRef.current()
        resolvePassRef.current = null
      }
    }
  }, [deck, isRendering])
}
