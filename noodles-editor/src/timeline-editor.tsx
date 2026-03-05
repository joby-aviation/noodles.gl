import type { Deck, DeckProps } from '@deck.gl/core'
import { MapboxOverlay, type MapboxOverlayProps } from '@deck.gl/mapbox'
import { DeckGL } from '@deck.gl/react'
import { ReactFlowProvider } from '@xyflow/react'
import type { Map as MapLibre } from 'maplibre-gl'
import { forwardRef, useCallback, useEffect, useRef, useState } from 'react'
import ReactMapGL, { type MapProps, useControl } from 'react-map-gl/maplibre'
import { Layout } from './layout'
import { ErrorBoundary } from './noodles/components/error-boundary'
import { TopMenuBar } from './noodles/components/top-menu-bar'
import { ExportActionsProvider } from './noodles/contexts/export-actions-context'
import { useRenderSettings } from './noodles/hooks/use-render-settings'
import { getNoodles } from './noodles/noodles'
import type { RenderSettings } from './noodles/utils/serialization'
import { useDeckDrawLoop } from './render/draw-loop'
import { captureScreenshot, useRenderer } from './render/renderer'
import { TransformScale } from './render/transform-scale'
import { CollapsibleTimelinePanel } from './timeline/components/CollapsibleTimelinePanel'
import { useTimelineStore } from './timeline/timeline-store'
import s from './timeline-editor.module.css'
import { debugRender } from './utils/debug'
import setRef from './utils/set-ref'

function useSequenceLength() {
  return useTimelineStore(state => state.sequence.length)
}

const DeckGLOverlay = forwardRef<
  Deck,
  MapboxOverlayProps & {
    renderer: RenderSettings
    isRendering: boolean
  }
>(({ renderer, isRendering, ...props }, ref) => {
  // MapboxOverlay handles a variety of props differently than the Deck class.
  // https://deck.gl/docs/api-reference/mapbox/mapbox-overlay#constructor
  const deck = useControl<MapboxOverlay>(() => new MapboxOverlay({ ...props, interleaved: true }))

  if (!isRendering) {
    deck.setProps({
      ...props,
      // TODO: Cleanup onAfterRender from draw loop as a post-render step instead
      onAfterRender: props.onAfterRender ? props.onAfterRender : () => {},
    })
  }

  // @ts-expect-error private property
  const deckgl = deck._deck
  // const gl = deckgl?.props.gl

  useDeckDrawLoop({
    deck: deckgl,
    isRendering,
    rendererConfig: renderer,
    props,
  })

  // @ts-expect-error private property
  setRef(ref, deck._deck)
  return null
})

const isMapReady = (map: MapLibre | null) => !map || (map.isStyleLoaded() && map.areTilesLoaded())

export default function TimelineEditor() {
  const mapRef = useRef<MapLibre | null>(null)
  const deckRef = useRef<Deck>(null)
  const isRenderingRef = useRef(false)

  // Trigger a redraw of React, mapbox and deck when the renderer state changes,
  // to ensure that the VideoStreamReader in renderer.ts runs
  const [_, setRand] = useState(0)
  const redraw = useCallback(() => {
    mapRef.current?.redraw()
    deckRef.current?.redraw()
    // Only trigger React re-renders outside of the render loop — during export this
    // runs every frame and causes CSSStyleRule/DOM churn from React re-renders.
    if (!isRenderingRef.current) setRand(Math.random())
  }, [])

  const noodles = getNoodles()
  const { flowGraph, nodeSidebar, propertiesPanel, layoutMode, ...visualization } = noodles

  // Render settings are now stored as OutOp inputs
  const renderSettings = useRenderSettings()

  const sequenceLength = useSequenceLength()

  const { framerate, bitrateMbps, bitrateMode, codec, resolution, lod, waitForData, captureDelay } =
    renderSettings

  const { startCapture, captureFrame, currentFrame, isRendering } = useRenderer({
    projectName: noodles.projectName ?? 'render',
    fps: framerate,
    bitrate: bitrateMbps * 1_000_000,
    bitrateMode,
    redraw,
  })
  isRenderingRef.current = isRendering

  // If the visualization doesn't supply mapProps (or has a blank mapStyle), disable basemap.
  // A blank mapStyle is treated as transparent — DeckGL renders without map tiles.
  // TODO: Detect if deck is in othorgraphic mode, and disable?
  const basemapEnabled = Boolean(visualization.mapProps?.mapStyle)
  // console.log(rgbaToClearColor(mapState.background))

  // Track deck.gl rendering stats for Claude AI debugging
  const lastFrameTimeRef = useRef(Date.now())
  const fpsRef = useRef(0)

  const deckProps: DeckProps = {
    deviceProps: {
      type: 'webgl',
      powerPreference: 'high-performance',
      webgl: {
        stencil: true,
      },
    },
    useDevicePixels: false,
    ...visualization.deckProps,
    onDeviceInitialized: device => {
      visualization.deckProps?.onDeviceInitialized?.(device)
      redraw()
    },
    onAfterRender: () => {
      visualization.deckProps?.onAfterRender?.()

      // Track FPS and stats for Claude AI debugging
      // Use deck.gl's built-in fps metric when available
      const now = Date.now()
      const deltaTime = now - lastFrameTimeRef.current
      lastFrameTimeRef.current = now
      const calculatedFps = deltaTime > 0 ? Math.round(1000 / deltaTime) : 0

      // Prefer deck.gl's built-in fps metric
      const deckFps = deckRef.current?.metrics?.fps
      fpsRef.current = deckFps !== undefined ? deckFps : calculatedFps

      // Expose stats globally for MCPTools
      ;(window as Window & { __deckStats?: Record<string, unknown> }).__deckStats = {
        fps: fpsRef.current,
        lastFrameTime: deltaTime,
        layerCount: deckRef.current?.layerManager?.getLayers().length || 0,
        timestamp: now,
      }
    },
  }

  // Destructure light and sky since they're applied imperatively via setLight/setSky
  const { light, sky, ...basemapProps } = visualization.mapProps ?? {}
  const mapProps: MapProps = {
    interactive: false,
    antialias: true,
    preserveDrawingBuffer: true,
    onLoad: ({ target: map }) => {
      // Redraw react to ensure hooks check for map ref changes
      mapRef.current = map
      redraw()
    },
    ...basemapProps,
    maxPitch: Math.min(basemapProps?.maxPitch ?? 85, 85),
  }

  // Apply light and sky settings imperatively to avoid style reloading
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return

    // Note: light settings only apply to globe projection
    if (light) {
      map.setLight({
        anchor: light.anchor,
        position: [1.15, light.azimuthal, light.polar],
      })
    }

    if (sky?.enabled) {
      // Note: skyColor, horizonColor, skyHorizonBlend only apply to mercator projection
      // Note: atmosphereBlend only applies to globe projection
      map.setSky({
        'sky-color': sky.skyColor,
        'horizon-color': sky.horizonColor,
        'sky-horizon-blend': sky.skyHorizonBlend,
        'atmosphere-blend': sky.atmosphereBlend,
      })
    } else {
      // Disable sky - requires MapLibre GL JS 4.6.0+
      map.setSky(undefined)
    }
  }, [light, sky])
  // Expose deck.gl canvas and instance for Claude AI visual debugging
  useEffect(() => {
    if (deckRef.current) {
      // @ts-expect-error canvas is protected but accessible
      const canvas = deckRef.current.canvas
      if (canvas) {
        // Store canvas globally for MCPTools to access
        ;(window as Window & { __deckCanvas?: unknown }).__deckCanvas = canvas
      }
      // Store deck instance globally for layer inspection
      ;(window as Window & { __deckInstance?: unknown }).__deckInstance = deckRef.current
    }
  }, [])

  // onIdle resolves when all data is loaded and drawing has settled.
  mapProps.onIdle = ({ target: map }) => {
    mapRef.current = map
    // Wait for map tiles to load before capturing.
    if (!isMapReady(map)) {
      debugRender('map waiting')
      return
    }
    // This should alert the renderer that the scene is ready to be captured
    // Because onIdle can be synchronous, we need to defer the promise resolution to the next tick.
    // TODO: Perhaps set up the promises refs before the render loop, and then later await the Promise.all?
    // Delay rendering by 200ms so that deck and maplibre can settle before capturing.
    setTimeout(() => captureFrame(), captureDelay)
  }

  const pureDeckInstance = !basemapEnabled ? deckRef.current : null
  useDeckDrawLoop({
    deck: pureDeckInstance,
    isRendering,
    captureFrame,
    rendererConfig: {
      waitForData,
      captureDelay,
    },
    props: deckProps,
  })

  const startRender = useCallback(async () => {
    let canvas: HTMLCanvasElement | null = null

    if (basemapEnabled) {
      if (!mapRef.current) {
        debugRender('Start Render: maplibre is not defined (when basemapEnabled is true)')
        return
      }
      canvas = mapRef.current.getCanvas()
    } else {
      // Pure Deck.gl mode
      if (!deckRef.current) {
        debugRender('Start Render: deckRef is not defined (when basemapEnabled is false)')
        return
      }
      // @ts-expect-error canvas is protected but accessible
      canvas = deckRef.current.canvas
    }

    if (!canvas) {
      debugRender('Start Render: Failed to get canvas element')
      return
    }

    await startCapture({
      canvas,
      codec,
      // This always scales the video to the specified value, regardless of `canvas` size
      ...resolution,
    })
  }, [startCapture, codec, resolution, basemapEnabled])

  const takeScreenshot = useCallback(async () => {
    if (!deckRef.current) {
      debugRender('Take Screenshot: deck is not defined')
      return
    }
    if (basemapEnabled && !mapRef.current) {
      debugRender('Take Screenshot: maplibre is not defined')
      return
    }

    const suggestedName = noodles.projectName ?? 'screenshot'
    await captureScreenshot(suggestedName, () => {
      redraw()
      // @ts-expect-error canvas is protected
      return deckRef.current.canvas!
    })
  }, [noodles.projectName, redraw, basemapEnabled])

  // Increase the render target resolution to increase map tile detail.
  // To convert viewport bounds back to their original size, add about 1 to the zoom value.
  const lodResolution = {
    width: Math.round(resolution.width * lod),
    height: Math.round(resolution.height * lod),
  }

  // Use fixed resolution for 'fixed' display mode, undefined for 'responsive' mode to use natural dimensions
  const isFixedMode = renderSettings.display === 'fixed'
  const displayResolution = isFixedMode ? lodResolution : undefined

  const renderContent = () => {
    if (basemapEnabled) {
      return (
        <ReactMapGL style={displayResolution} {...mapProps}>
          <DeckGLOverlay
            ref={deckRef}
            renderer={renderSettings}
            isRendering={isRendering}
            {...deckProps}
          />
        </ReactMapGL>
      )
    }
    return (
      <DeckGL
        ref={ref => setRef(deckRef, ref?.deck)}
        {...deckProps}
        {...(displayResolution || {})}
      />
    )
  }

  const topBar = (
    <TopMenuBar
      projectName={noodles.projectName}
      onSaveProject={noodles.onSaveProject!}
      onSaveAs={noodles.onSaveAs}
      onRename={noodles.onRename}
      onDownload={noodles.onDownload}
      onNewProject={noodles.onNewProject!}
      onImport={noodles.onImport!}
      onOpen={noodles.onOpen}
      onOpenAddNode={noodles.onOpenAddNode}
      showChatPanel={noodles.showChatPanel}
      onChangeShowChatPanel={noodles.onChangeShowChatPanel}
      undoRedoRef={noodles.undoRedoRef!}
      copyControlsRef={noodles.copyControlsRef!}
      reactFlowRef={noodles.reactFlowRef}
      startRender={startRender}
      takeScreenshot={takeScreenshot}
      isRendering={isRendering}
      hasUnsavedChanges={noodles.hasUnsavedChanges}
      showOverlay={noodles.showOverlay}
      onChangeShowOverlay={noodles.onChangeShowOverlay}
      showDebugInfo={noodles.showDebugInfo}
      onChangeShowDebugInfo={noodles.onChangeShowDebugInfo}
      layoutMode={noodles.layoutMode}
      onChangeLayoutMode={noodles.onChangeLayoutMode}
    />
  )

  return (
    <>
      {isRendering && (
        <div className={s.actionButtons}>
          <progress
            max={sequenceLength * renderSettings.framerate}
            value={currentFrame}
            title={`Rendered ${currentFrame} / ${sequenceLength * renderSettings.framerate}`}
          />
        </div>
      )}
      <ReactFlowProvider>
        <ExportActionsProvider
          startRender={startRender}
          takeScreenshot={takeScreenshot}
          isRendering={isRendering}
        >
          <Layout
            top={topBar}
            left={nodeSidebar}
            right={propertiesPanel}
            bottom={<CollapsibleTimelinePanel />}
            flowGraph={flowGraph}
            layoutMode={layoutMode}
          >
            {isFixedMode ? (
              <TransformScale scale={renderSettings.scaleControl}>
                <ErrorBoundary title="Visualization Error">{renderContent()}</ErrorBoundary>
              </TransformScale>
            ) : (
              <ErrorBoundary title="Visualization Error">{renderContent()}</ErrorBoundary>
            )}
          </Layout>
        </ExportActionsProvider>
      </ReactFlowProvider>
    </>
  )
}
