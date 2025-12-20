import type { Deck } from '@deck.gl/core'
import { useEffect, useRef } from 'react'

interface UseDeckDrawLoopProps {
  deck: Deck | null
  isRendering: boolean
  // Optional callback to capture the frame, can be used when rendering a pure deck.gl scene.
  // Scenes interleaved with maplibre would use maplibre's draw callbacks.
  captureFrame?: (result?: { error?: Error }) => void
  // Callback to expose frame request function to renderer
  onFrameRequestReady?: (requestFrame: () => void) => void
  // Ref to hold the frame capture resolver (for pure deck mode)
  frameResolverRef?: React.MutableRefObject<((value?: unknown) => void) | null>
  // Flag to indicate we're waiting for a specific redraw
  expectingRedrawRef?: React.MutableRefObject<boolean>
  // Flag to prevent multiple setTimeout callbacks per frame
  timeoutScheduledRef?: React.MutableRefObject<boolean>
}

export function useDeckDrawLoop({
  deck,
  isRendering,
  captureFrame,
  onFrameRequestReady,
  frameResolverRef,
  expectingRedrawRef,
  timeoutScheduledRef,
}: UseDeckDrawLoopProps) {
  const captureFrameRef = useRef(captureFrame)

  // Keep captureFrame ref up to date
  useEffect(() => {
    captureFrameRef.current = captureFrame
  }, [captureFrame])

  // Expose a requestFrame function that the renderer can call when ready for next frame
  useEffect(() => {
    if (!isRendering || !deck || !onFrameRequestReady || !frameResolverRef || !expectingRedrawRef) {
      return
    }

    console.log('[useDeckDrawLoop] Setting up requestFrame for pure deck mode')

    // Function that renderer calls to request a frame
    const requestFrame = async () => {
      try {
        console.log('[useDeckDrawLoop] Frame requested')

        // Clear timeout flag from previous frame to allow new timeouts
        // This is done here instead of in the setTimeout callback to prevent
        // race conditions with captureDelay=0
        if (timeoutScheduledRef) {
          timeoutScheduledRef.current = false
        }

        // Set up promise for this frame - resolver is stored in frameResolverRef
        // The onAfterRender in deckProps will resolve it
        const passPromise = new Promise(res => {
          frameResolverRef.current = res
        })

        // Small delay to let any pending setProps calls complete
        await new Promise(resolve => setTimeout(resolve, 0))

        // Set flag IMMEDIATELY before redraw with no gap for spurious onAfterRender
        console.log('[useDeckDrawLoop] Calling deck.redraw()')
        expectingRedrawRef.current = true
        deck.redraw('frame-capture')

        // Wait for onAfterRender to resolve
        console.log('[useDeckDrawLoop] Waiting for onAfterRender...')
        await passPromise
        console.log('[useDeckDrawLoop] Frame captured, calling captureFrame callback')
        captureFrameRef.current?.()
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e))
        console.error('[useDeckDrawLoop] Error during frame capture:', error)
        captureFrameRef.current?.({ error })
        frameResolverRef.current = null
        expectingRedrawRef.current = false
      }
    }

    // Expose the requestFrame function to the renderer
    onFrameRequestReady(requestFrame)

    // Cleanup
    return () => {
      console.log('[useDeckDrawLoop] Cleanup')
      if (frameResolverRef.current) {
        console.warn('[useDeckDrawLoop] Cleaning up pending frame resolver')
        frameResolverRef.current()
        frameResolverRef.current = null
      }
      expectingRedrawRef.current = false
    }
  }, [deck, isRendering, onFrameRequestReady, frameResolverRef, expectingRedrawRef, timeoutScheduledRef])
}
