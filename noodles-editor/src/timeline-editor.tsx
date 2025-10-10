import type { Deck, DeckProps } from '@deck.gl/core'
import { MapboxOverlay, type MapboxOverlayProps } from '@deck.gl/mapbox'
import { DeckGL } from '@deck.gl/react'
import { types, val } from '@theatre/core'
import studio from '@theatre/studio'
import { ReactFlowProvider } from '@xyflow/react'
import type { Map as MapLibre } from 'maplibre-gl'
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMapGL, { type MapProps, useControl } from 'react-map-gl/maplibre'
import NotFound from './not-found'
import { useDeckDrawLoop } from './render/draw-loop'
import { captureScreenshot, rafDriver, useRenderer } from './render/renderer'
import { TransformScale } from './render/transform-scale'
import setRef from './utils/set-ref'
import useSheetValue, { type PropsValue } from './utils/use-sheet-value'
import { projectId } from './noodles/globals'
import { getNoodles } from './noodles/noodles'
import { NoodlesProvider } from './noodles/store'
import { WidgetContainer } from './widget-container'

import 'maplibre-gl/dist/maplibre-gl.css'

// https://www.theatrejs.com/docs/latest/manual/advanced#rafdrivers
// the rafDriver breaks things like spacebar playback
studio.initialize({
  __experimental_rafDriver: rafDriver,
  usePersistentStorage: false,
})

const INITIAL_RENDER_STATE = {
  display: types.stringLiteral('fixed', {
    fixed: 'fixed',
    responsive: 'responsive',
  }),
  resolution: types.compound({
    width: types.number(1920),
    height: types.number(1080),
  }),
  lod: types.number(2, { range: [1, 2] }),
  waitForData: types.boolean(true),
  codec: types.stringLiteral('avc', {
    hevc: 'hevc', // h265
    vp9: 'vp9',
    av1: 'av1',
    avc: 'avc', // h264
  }),
  bitrateMbps: types.number(10, { range: [5, 60] }),
  bitrateMode: types.stringLiteral('constant', {
    constant: 'constant',
    variable: 'variable',
  }),
  scaleControl: types.number(0.3, { range: [0, 1] }),
  framerate: types.number(30, { range: [0.001, 1000] }),
  // TODO: fix render jitter and remove this frame capture delay
  captureDelay: types.number(200, { range: [0, 2000] }),
}

const DeckGLOverlay = forwardRef<
  Deck,
  MapboxOverlayProps & {
    renderer: PropsValue<typeof INITIAL_RENDER_STATE>
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
  const [ready, setReady] = useState(false)
  const startRenderRef = useRef(async () => {})
  const takeScreenshotRef = useRef(async () => {})
  const advanceFrameRef = useRef(() => {})

  const mapRef = useRef<MapLibre | null>(null)
  const deckRef = useRef<Deck>(null)

  // Trigger a redraw of React, mapbox and deck when the renderer state changes,
  // to ensure that the VideoStreamReader in renderer.ts runs
  const [_, setRand] = useState(0)
  const redraw = useCallback(() => {
    console.warn('redraw', mapRef.current, deckRef.current)
    mapRef.current?.redraw()
    deckRef.current?.redraw()
    setRand(Math.random())
  }, [])

  const { project, sheet, widgets, layoutMode, ...visualization } = getNoodles()
  const sequence = sheet.sequence

  useEffect(() => {
    project?.ready.then(() => setReady(true))
  }, [project])

  const { rendererSheet } = useMemo(() => {
    const rendererSheet = sheet?.object('render', INITIAL_RENDER_STATE, {
      __actions__THIS_API_IS_UNSTABLE_AND_WILL_CHANGE_IN_THE_NEXT_VERSION: {
        startRender: async () => {
          await startRenderRef.current()
        },
        advanceFrame: () => {
          advanceFrameRef.current()
        },
        takeScreenshot: async () => {
          await takeScreenshotRef.current()
        },
      },
    })

    return {
      rendererSheet,
    }
  }, [sheet])

  const renderer = useSheetValue(rendererSheet)

  const { framerate, bitrateMbps, bitrateMode, codec, resolution, lod, waitForData, captureDelay } =
    renderer

  const { startCapture, captureFrame, currentFrame, advanceFrame, _animate, isRendering } =
    useRenderer({
      project,
      sequence: sequence,
      fps: framerate,
      bitrate: bitrateMbps * 1_000_000,
      bitrateMode,
      redraw,
    })

  // If the visualization doesn't supply mapProps, disable basemap.
  // TODO: Detect if deck is in othorgraphic mode, and disable?
  const basemapEnabled = Boolean(visualization.mapProps)
  // console.log(rgbaToClearColor(mapState.background))
  const deckProps: DeckProps = {
    _animate,
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
  }

  const mapProps: MapProps = {
    interactive: false,
    antialias: true,
    preserveDrawingBuffer: true,
    onLoad: ({ target: map }) => {
      // Redraw react to ensure hooks check for map ref changes
      mapRef.current = map
      redraw()
    },
    ...visualization.mapProps,
    ...(visualization.mapProps?.maxPitch
      ? { maxPitch: Math.min(visualization.mapProps?.maxPitch, 85) }
      : {}),
  }

  useEffect(() => {
    if (_animate) {
      mapRef.current?.redraw()
    }
  }, [_animate])

  // onIdle resolves when all data is loaded and drawing has settled.
  mapProps.onIdle = ({ target: map }) => {
    mapRef.current = map
    // Wait for map tiles to load before capturing.
    if (!isMapReady(map)) {
      console.warn('map waiting')
      return
    }
    // This should alert the renderer that the scene is ready to be captured
    // Because onIdle can be synchronous, we need to defer the promise resolution to the next tick.
    // TODO: Perhaps set up the promises refs before the render loop, and then later await the Promise.all?
    // Delay rendering by 200ms so that deck and maplibre can settle before capturing.
    setTimeout(() => captureFrame(), captureDelay)
  }

  // TODO: Move to a TheatreJS extension:
  // https://www.theatrejs.com/docs/latest/manual/authoring-extensions

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

  startRenderRef.current = useCallback(async () => {
    let canvas: HTMLCanvasElement | null = null

    if (basemapEnabled) {
      if (!mapRef.current) {
        console.error('Start Render: maplibre is not defined (when basemapEnabled is true)')
        return
      }
      canvas = mapRef.current.getCanvas()
    } else {
      // Pure Deck.gl mode
      if (!deckRef.current) {
        console.error('Start Render: deckRef is not defined (when basemapEnabled is false)')
        return
      }
      // @ts-expect-error canvas is protected but accessible
      canvas = deckRef.current.canvas
    }

    if (!canvas) {
      console.error('Start Render: Failed to get canvas element')
      return
    }

    await startCapture({
      canvas,
      codec,
      // This always scales the video to the specified value, regardless of `canvas` size
      ...resolution,
    })
  }, [startCapture, codec, resolution, basemapEnabled])

  takeScreenshotRef.current = useCallback(async () => {
    if (!deckRef.current) {
      console.error('Take Screenshot: deck is not defined')
      return
    }
    if (basemapEnabled && !mapRef.current) {
      console.error('Take Screenshot: maplibre is not defined')
      return
    }

    const suggestedName = project.address.projectId
    await captureScreenshot(suggestedName, () => {
      redraw()
      // @ts-expect-error canvas is protected
      return deckRef.current.canvas!
    })
  }, [project.address.projectId, redraw, basemapEnabled])

  advanceFrameRef.current = advanceFrame

  // Increase the render target resolution to increase map tile detail.
  // To convert viewport bounds back to their original size, add about 1 to the zoom value.
  const lodResolution = {
    width: Math.round(resolution.width * lod),
    height: Math.round(resolution.height * lod),
  }

  // Use fixed resolution for 'fixed' display mode, undefined for 'responsive' mode to use natural dimensions
  const isFixedMode = renderer.display === 'fixed'
  const displayResolution = isFixedMode ? lodResolution : undefined

  if (!projectId) {
    return <NotFound />
  }

  if (!ready) {
    // don't call project.getAssetUrl until Theatre project is ready
    return <div>loading project...</div>
  }

  const renderContent = () => {
    if (basemapEnabled) {
      return (
        <ReactMapGL style={displayResolution} {...mapProps}>
          <DeckGLOverlay
            ref={deckRef}
            renderer={renderer}
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

  return (
    <>
      {isRendering && (
        <div className="action-buttons">
          <progress
            max={val(sequence.pointer.length) * renderer.framerate}
            value={currentFrame}
            title={`Rendered ${currentFrame} / ${
              val(sequence.pointer.length) * renderer.framerate
            }`}
          />
        </div>
      )}
      <NoodlesProvider>
        <ReactFlowProvider>
          <WidgetContainer widgets={widgets} layoutMode={layoutMode}>
            {isFixedMode ? (
              <TransformScale scale={renderer.scaleControl}>{renderContent()}</TransformScale>
            ) : (
              renderContent()
            )}
          </WidgetContainer>
        </ReactFlowProvider>
      </NoodlesProvider>
    </>
  )
}
