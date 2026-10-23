import type { Deck, DeckProps } from '@deck.gl/core'
import { MapLibreOverlay, type MapLibreOverlayProps } from '@deck.gl/maplibre'
import { DeckGL } from '@deck.gl/react'
import { ReactFlowProvider } from '@xyflow/react'
import type { CustomLayerInterface, Map as MapLibre } from 'maplibre-gl'
import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import ReactMapGL, { type MapProps, useControl } from 'react-map-gl/maplibre'
import { Layout } from './layout'
import { ErrorBoundary } from './noodles/components/error-boundary'
import { SpreadsheetPane } from './noodles/components/spreadsheet-pane/spreadsheet-pane'
import { MapToolLayer } from './noodles/components/tools/map-tool-layer'
import { TopMenuBar } from './noodles/components/top-menu-bar'
import { ExportActionsProvider } from './noodles/contexts/export-actions-context'
import { useActiveStorageType, useCurrentDirectory } from './noodles/filesystem-store'
import { useActiveOutOp } from './noodles/hooks/use-active-outop'
import { useRenderSettings } from './noodles/hooks/use-render-settings'
import { getNoodles } from './noodles/noodles'
import { fnWithSource } from './noodles/operators'
import { useUIStore } from './noodles/store'
import {
  createCameraGestureHistory,
  updateCameraInputs,
  useCameraControlState,
} from './noodles/utils/map-camera-control'
import { captureOperatorInputs, firePropertyMutation } from './noodles/utils/property-history'
import type { RenderSettings } from './noodles/utils/serialization'
import { PREVIEW_FRAME_DELAY, useDeckDrawLoop } from './render/draw-loop'
import { FrameCounter } from './render/frame-stats'
import type { RenderSource } from './render/render-analytics'
import { resetRenderProgress, setRenderProgress } from './render/render-progress-store'
import {
  calculateRenderSurfaceSize,
  observeRenderSurface,
  setRenderSurfaceSize,
} from './render/render-surface-size'
import { captureScreenshot, useRenderer } from './render/renderer'
import { deckRenderingDefaults, mapRenderingDefaults } from './render/rendering-defaults'
import { exposeCanvasToTools } from './render/tool-canvas'
import { TransformScale } from './render/transform-scale'
import {
  exportsTransparentVideo,
  resolveExportSettings,
  setVideoExporter,
  type VideoExporter,
} from './render/video-export'
import { TimelinePanel } from './timeline/components/TimelinePanel'
import { getTimelineStore, useTimelineStore } from './timeline/timeline-store'
import s from './timeline-editor.module.css'
import { debugRender } from './utils/debug'
import setRef from './utils/set-ref'
import { workerSetTimeout } from './utils/worker-timer'

function useSequenceLength() {
  return useTimelineStore(state => state.sequence.length)
}

const DeckGLOverlay = forwardRef<
  Deck,
  MapLibreOverlayProps & {
    renderer: RenderSettings
    isRendering: boolean
  }
>(({ renderer, isRendering, ...props }, ref) => {
  // MapLibreOverlay handles a variety of props differently than the Deck class.
  // https://deck.gl/docs/api-reference/maplibre/overview
  const deck = useControl<MapLibreOverlay>(
    () => new MapLibreOverlay({ ...props, interleaved: true })
  )

  if (!isRendering) {
    deck.setProps({
      ...props,
      // TODO: Cleanup onAfterRender from draw loop as a post-render step instead
      onAfterRender: props.onAfterRender ? props.onAfterRender : () => {},
    })
  } else if (renderer.captureMode === 'preview') {
    // Preview keeps the layers in sync during export. The map's render event drives
    // capture, so onAfterRender is a no-op.
    deck.setProps({ ...props, onAfterRender: () => {} })
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

// Helper function to evaluate MapLibre layer code using shared fnWithSource utility
function evaluateMapLibreLayerCode(
  code: string,
  params: Record<string, unknown>,
  layerId: string,
  map: MapLibre
): Partial<CustomLayerInterface> {
  const fn = fnWithSource(['params', 'map'], code, layerId)
  const result = fn(params, map)

  if (typeof result !== 'object' || result === null) {
    throw new Error('Layer code must return an object')
  }

  if (typeof result.render !== 'function') {
    throw new Error('Layer code must define a render() method')
  }

  return result as Partial<CustomLayerInterface>
}

export default function TimelineEditor() {
  const mapRef = useRef<MapLibre | null>(null)
  const deckRef = useRef<Deck>(null)
  const renderSurfaceRef = useRef<HTMLDivElement>(null)
  const isRenderingRef = useRef(false)
  // Session-only handle set by selectRendersDirectory; takes priority over project subdir
  const rendersDirectoryHandleRef = useRef<FileSystemDirectoryHandle | null>(null)
  const customLayersRef = useRef<Set<string>>(new Set())
  // Track style version to trigger layer re-addition after style changes
  const [styleVersion, setStyleVersion] = useState(0)

  // Trigger a redraw of React, mapbox and deck when the renderer state changes,
  // to ensure that the VideoStreamReader in renderer.ts runs
  const [_, setRand] = useState(0)
  const lastRedrawTime = useRef(0)
  const frameCapturedRef = useRef(false)
  const redraw = useCallback(() => {
    lastRedrawTime.current = performance.now()
    frameCapturedRef.current = false
    mapRef.current?.redraw()
    deckRef.current?.redraw()
    // Only trigger React re-renders outside of the render loop — during export this
    // runs every frame and causes CSSStyleRule/DOM churn from React re-renders.
    if (!isRenderingRef.current) setRand(Math.random())
  }, [])

  const noodles = getNoodles()
  const {
    flowGraph,
    nodeSidebar,
    propertiesPanel,
    chatPanel,
    gitHistoryPanel,
    selectedNodeIds,
    edges,
    ...visualization
  } = noodles

  const setTimelineExpanded = useUIStore(state => state.setTimelineExpanded)

  // Render settings are now stored as OutOp inputs
  const renderSettings = useRenderSettings()
  // Active OutOp for updating rendersDirectory when user picks a directory
  const activeOutOp = useActiveOutOp()
  // File system state for resolving the renders directory
  const currentDirectory = useCurrentDirectory()
  const activeStorageType = useActiveStorageType()

  const sequenceLength = useSequenceLength()
  const inPoint = useTimelineStore(state => state.sequence.inPoint)
  const outPoint = useTimelineStore(state => state.sequence.outPoint)

  const {
    framerate,
    bitrateMbps,
    bitrateMode,
    codec,
    resolution,
    lod,
    waitForData,
    captureDelay,
    captureMode,
    rendersDirectory,
    sequenceFormat,
  } = renderSettings
  const preview = captureMode === 'preview'
  // Both canvases already have an alpha channel: MapLibre always asks for one, and
  // deck.gl's context keeps the browser default. So transparency needs no new context.
  const exportAlpha = exportsTransparentVideo(renderSettings)

  const { startCapture, startSequenceCapture, captureFrame, isRendering } = useRenderer({
    projectName: noodles.projectName ?? 'render',
    fps: framerate,
    bitrate: bitrateMbps * 1_000_000,
    bitrateMode,
    redraw,
  })
  isRenderingRef.current = isRendering

  const isPlaying = useTimelineStore(state => state.playing)
  const cameraControl = useCameraControlState(selectedNodeIds ?? [], {
    edges: edges ?? [],
    isRendering,
    isPlaying,
  })
  const cameraHistoryRef = useRef(
    createCameraGestureHistory(captureOperatorInputs, before =>
      firePropertyMutation('Move map camera', before)
    )
  )
  const deckCameraGestureActiveRef = useRef(false)

  const beginCameraGesture = useCallback(() => {
    if (!cameraControl.enabled) return
    cameraHistoryRef.current.begin()
  }, [cameraControl.enabled])

  const updateSelectedCamera = useCallback(
    (viewState: unknown) => {
      if (!cameraControl.enabled || !cameraControl.op) return
      beginCameraGesture()
      updateCameraInputs(cameraControl.op, viewState)
    },
    [beginCameraGesture, cameraControl]
  )

  const finishCameraGesture = useCallback(() => {
    cameraHistoryRef.current.finish()
  }, [])

  // If the visualization doesn't supply mapProps (or has a blank mapStyle), disable basemap.
  // A blank mapStyle is treated as transparent — DeckGL renders without map tiles.
  // TODO: Detect if deck is in othorgraphic mode, and disable?
  const basemapEnabled = Boolean(visualization.mapProps?.mapStyle)
  // console.log(rgbaToClearColor(mapState.background))

  // Counts drawn frames for get_render_stats
  const [frames] = useState(() => new FrameCounter())

  const visualizationDeckProps = visualization.deckProps
  const deckProps: DeckProps = {
    ...deckRenderingDefaults,
    ...visualizationDeckProps,
    controller: !basemapEnabled && cameraControl.enabled,
    onViewStateChange: params => {
      const result = visualizationDeckProps?.onViewStateChange?.(params)
      if (!basemapEnabled) updateSelectedCamera(result ?? params.viewState)
      return result
    },
    onInteractionStateChange: interactionState => {
      visualizationDeckProps?.onInteractionStateChange?.(interactionState)
      if (basemapEnabled || !cameraControl.enabled) return
      const active = Boolean(
        interactionState.isDragging ||
          interactionState.isPanning ||
          interactionState.isRotating ||
          interactionState.isZooming
      )
      if (active && !deckCameraGestureActiveRef.current) beginCameraGesture()
      if (!active && deckCameraGestureActiveRef.current) finishCameraGesture()
      deckCameraGestureActiveRef.current = active
    },
    onDeviceInitialized: device => {
      visualizationDeckProps?.onDeviceInitialized?.(device)
      redraw()
    },
    onAfterRender: () => {
      visualizationDeckProps?.onAfterRender?.()
      frames.frame()
    },
  }

  // Destructure light and sky since they're applied imperatively via setLight/setSky
  const {
    light,
    sky,
    onMove: visualizationOnMove,
    onMoveStart: visualizationOnMoveStart,
    onMoveEnd: visualizationOnMoveEnd,
    ...basemapProps
  } = visualization.mapProps ?? {}
  const mapProps: MapProps = {
    ...mapRenderingDefaults,
    // Preview exports capture on the first render, so tiles must appear without fading in.
    // Leave the key out otherwise: an explicit undefined overrides MapLibre's default and
    // labels never finish fading in, so the map never goes idle.
    ...(isRendering && preview ? { fadeDuration: 0 } : {}),
    onLoad: ({ target: map }) => {
      // Redraw react to ensure hooks check for map ref changes
      mapRef.current = map
      redraw()
    },
    ...basemapProps,
    maxPitch: Math.min(basemapProps?.maxPitch ?? 85, 85),
    interactive: cameraControl.enabled,
    dragPan: cameraControl.enabled,
    dragRotate: cameraControl.enabled,
    scrollZoom: cameraControl.enabled,
    boxZoom: cameraControl.enabled,
    doubleClickZoom: cameraControl.enabled,
    keyboard: cameraControl.enabled,
    touchZoomRotate: cameraControl.enabled,
    touchPitch: cameraControl.enabled,
    onMoveStart: event => {
      visualizationOnMoveStart?.(event)
      beginCameraGesture()
    },
    onMove: event => {
      visualizationOnMove?.(event)
      updateSelectedCamera(event.viewState)
    },
    onMoveEnd: event => {
      visualizationOnMoveEnd?.(event)
      finishCameraGesture()
    },
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

  // Manage custom MapLibre layers
  // biome-ignore lint/correctness/useExhaustiveDependencies: styleVersion re-adds the layers after a style reload
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return

    const layerConfigs = visualization.maplibreLayers || []
    const desiredLayerIds = new Set(layerConfigs.map(config => config.id))

    // Remove layers that are no longer in the config
    for (const existingId of customLayersRef.current) {
      if (!desiredLayerIds.has(existingId)) {
        try {
          if (map.getLayer(existingId)) {
            map.removeLayer(existingId)
            debugRender('Removed custom MapLibre layer: %s', existingId)
          }
        } catch (e) {
          debugRender('Error removing custom MapLibre layer %s: %o', existingId, e)
        }
      }
    }

    // Add or update layers
    for (const config of layerConfigs) {
      try {
        const existingLayer = map.getLayer(config.id)

        if (existingLayer) {
          map.removeLayer(config.id)
        }

        const layerImpl = evaluateMapLibreLayerCode(
          config.code,
          config.params || {},
          config.id,
          map
        )

        const customLayer: CustomLayerInterface = {
          ...layerImpl,
          id: config.id,
          type: 'custom',
          renderingMode: config.renderingMode || '3d',
        }

        map.addLayer(customLayer, config.beforeId)
        customLayersRef.current.add(config.id)

        debugRender('Added/updated custom MapLibre layer: %s', config.id)
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e))
        debugRender('Error adding custom MapLibre layer %s: %o', config.id, error)
      }
    }

    customLayersRef.current = desiredLayerIds
  }, [visualization.maplibreLayers, styleVersion])

  // Clean up custom layers on unmount
  useEffect(() => {
    return () => {
      const map = mapRef.current
      if (!map) return

      for (const layerId of customLayersRef.current) {
        try {
          if (map.getLayer(layerId)) {
            map.removeLayer(layerId)
          }
        } catch (e) {
          debugRender('Error removing layer on cleanup: %o', e)
        }
      }
      customLayersRef.current.clear()
    }
  }, [])

  // Handle map style changes - increment styleVersion to trigger layer re-addition
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const handleStyleData = () => {
      customLayersRef.current.clear()
      setStyleVersion(v => v + 1)
    }

    map.on('styledata', handleStyleData)

    return () => {
      map.off('styledata', handleStyleData)
    }
  }, [])

  // The AI tools read the canvas, deck and frame stats through window globals
  useEffect(() => exposeCanvasToTools(deckRef, frames), [frames])

  // Preview exports capture on MapLibre's 'render' event instead of waiting for 'idle'.
  // A render event can fire before the frame has settled, so preview can drop or repeat
  // frames. Final exports keep waiting for idle below.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !isRendering || !preview) return

    const handleRender = () => {
      if (frameCapturedRef.current) return
      if (!isMapReady(map)) return

      if (waitForData) {
        const deck = deckRef.current
        if (
          deck &&
          !deck.props.layers.every(layer => !layer || (!Array.isArray(layer) && layer.isLoaded))
        ) {
          map.triggerRepaint()
          return
        }
      }

      frameCapturedRef.current = true
      debugRender(
        'onRender ready %dms after redraw',
        (performance.now() - lastRedrawTime.current).toFixed(1)
      )
      workerSetTimeout(() => captureFrame(), PREVIEW_FRAME_DELAY)
    }

    map.on('render', handleRender)
    return () => {
      map.off('render', handleRender)
    }
  }, [isRendering, preview, waitForData, captureFrame])

  // onIdle resolves when all data is loaded and drawing has settled. In preview exports
  // it is a fallback in case the render event above misses a frame.
  mapProps.onIdle = ({ target: map }) => {
    mapRef.current = map
    // Wait for map tiles to load before capturing.
    if (!isMapReady(map)) {
      debugRender('map waiting')
      return
    }
    // During rendering with waitForData, also confirm deck layers have finished loading.
    // mapIdle fires on map tile/style readiness only — it doesn't know about deck layer data.
    if (isRenderingRef.current && waitForData) {
      const deck = deckRef.current
      if (
        deck &&
        !deck.props.layers.every(layer => !layer || (!Array.isArray(layer) && layer.isLoaded))
      ) {
        debugRender('map idle, waiting for deck layers')
        return
      }
    }
    if (isRenderingRef.current && preview) {
      if (frameCapturedRef.current) return
      frameCapturedRef.current = true
      debugRender(
        'onIdle fallback %dms after redraw',
        (performance.now() - lastRedrawTime.current).toFixed(1)
      )
      workerSetTimeout(() => captureFrame(), PREVIEW_FRAME_DELAY)
      return
    }
    // This should alert the renderer that the scene is ready to be captured
    // Because onIdle can be synchronous, we need to defer the promise resolution to the next tick.
    // TODO: Perhaps set up the promises refs before the render loop, and then later await the Promise.all?
    // Delay rendering by 200ms so that deck and maplibre can settle before capturing.
    // Use worker timer so this fires even when the tab is switched.
    workerSetTimeout(() => captureFrame(), captureDelay)
  }

  const pureDeckInstance = !basemapEnabled ? deckRef.current : null
  useDeckDrawLoop({
    deck: pureDeckInstance,
    isRendering,
    captureFrame,
    rendererConfig: {
      waitForData,
      captureDelay,
      captureMode,
    },
    props: deckProps,
  })

  // The canvas exports record from. With a basemap this is the map canvas: the interleaved
  // deck draws into it. Unlike mapRef, it is there before the map's load event and never
  // outlives a removed basemap.
  const getDeckCanvas = useCallback(
    // @ts-expect-error canvas is protected but accessible
    (): HTMLCanvasElement | null => deckRef.current?.canvas ?? null,
    []
  )

  const startRender = useCallback(
    async (source: RenderSource = 'menu') => {
      // Two captures would share one frame-ready callback and the timeline position
      if (isRenderingRef.current) {
        debugRender('Start Render: an export is already running')
        return
      }

      const canvas = getDeckCanvas()
      if (!canvas) {
        debugRender('Start Render: the canvas is not ready yet')
        return
      }

      resetRenderProgress()
      const result = await startCapture({
        canvas,
        getCanvas: getDeckCanvas,
        codec,
        exportAlpha,
        captureMode,
        // This always scales the video to the specified value, regardless of `canvas` size
        ...resolution,
        startFrame: Math.floor((inPoint ?? 0) * framerate),
        endFrame: Math.floor((outPoint ?? sequenceLength) * framerate),
        source,
        onFrameComplete: setRenderProgress,
      })
      if (result.status === 'error') {
        alert(`Export failed: ${result.error.message}`)
      }
    },
    [
      startCapture,
      getDeckCanvas,
      codec,
      exportAlpha,
      captureMode,
      resolution,
      framerate,
      inPoint,
      outPoint,
      sequenceLength,
    ]
  )

  // The export_video tool's way in. Same canvas and render settings as startRender, but
  // the MP4 comes back as a buffer: the save dialog only opens on a click, which an
  // agent driving the editor cannot make. Always an opaque MP4, whatever exportAlpha says.
  const exportVideoForAgent = useCallback<VideoExporter>(
    (request, onFrameComplete) => {
      if (isRenderingRef.current) {
        return { status: 'refused', error: 'An export is already running in the editor' }
      }

      const canvas = getDeckCanvas()
      if (!canvas) {
        return {
          status: 'refused',
          error: 'The visualization canvas is not ready yet. Try again once the map has loaded.',
        }
      }

      const { sequence } = getTimelineStore()
      const resolved = resolveExportSettings(request, {
        sequenceLength: sequence.length,
        inPoint: sequence.inPoint,
        outPoint: sequence.outPoint,
        framerate,
        resolution,
        codec,
      })
      if (!resolved.ok) return { status: 'refused', error: resolved.error }

      const { settings } = resolved
      resetRenderProgress()
      return {
        status: 'started',
        settings,
        result: startCapture({
          canvas,
          getCanvas: getDeckCanvas,
          codec: settings.codec,
          // Must match the capture signal above, which follows the Out node's setting
          captureMode,
          width: settings.width,
          height: settings.height,
          fps: settings.fps,
          startFrame: settings.startFrame,
          endFrame: settings.endFrame,
          target: 'buffer',
          source: 'agent',
          onFrameComplete: (frame, total) => {
            setRenderProgress(frame, total)
            onFrameComplete(frame, total)
          },
        }),
      }
    },
    [startCapture, getDeckCanvas, codec, captureMode, resolution, framerate]
  )

  useEffect(() => {
    setVideoExporter(exportVideoForAgent)
    return () => setVideoExporter(null)
  }, [exportVideoForAgent])

  const takeScreenshot = useCallback(
    async (source: RenderSource = 'menu') => {
      if (!getDeckCanvas()) {
        debugRender('Take Screenshot: the canvas is not ready yet')
        return
      }

      const suggestedName = noodles.projectName ?? 'screenshot'
      await captureScreenshot(
        suggestedName,
        () => {
          redraw()
          // Read again: the save dialog can stay open while the basemap is added or removed
          const canvas = getDeckCanvas()
          if (!canvas) throw new Error('The canvas went away while the save dialog was open')
          return canvas
        },
        { source }
      )
    },
    [noodles.projectName, redraw, getDeckCanvas]
  )

  const selectRendersDirectory = useCallback(async () => {
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
      rendersDirectoryHandleRef.current = handle
      // Persist the folder name to the OutOp so it survives project reloads
      activeOutOp?.inputs.rendersDirectory.setValue(handle.name)
    } catch (e) {
      if ((e as DOMException).name !== 'AbortError') throw e
    }
  }, [activeOutOp])

  const exportSequence = useCallback(async () => {
    const canvas = getDeckCanvas()
    if (!canvas) {
      debugRender('Export Sequence: the canvas is not ready yet')
      return
    }

    // Resolve the target directory: session-picked handle > project subdir > user picker
    let rendersDir: FileSystemDirectoryHandle
    if (rendersDirectoryHandleRef.current) {
      rendersDir = rendersDirectoryHandleRef.current
    } else if (activeStorageType !== 'publicFolder' && currentDirectory) {
      try {
        rendersDir = await currentDirectory.getDirectoryHandle(rendersDirectory || 'renders', {
          create: true,
        })
      } catch (e) {
        debugRender('Failed to create renders directory: %o, falling back to picker', e)
        try {
          rendersDir = await window.showDirectoryPicker({ mode: 'readwrite' })
        } catch (err) {
          if ((err as DOMException).name === 'AbortError') return
          throw err
        }
      }
    } else {
      try {
        rendersDir = await window.showDirectoryPicker({ mode: 'readwrite' })
      } catch (e) {
        if ((e as DOMException).name === 'AbortError') return
        throw e
      }
    }

    resetRenderProgress()
    try {
      await startSequenceCapture({
        canvas,
        getCanvas: getDeckCanvas,
        // Basemap scenes use mapProps.onIdle for frame readiness; pure-deck scenes need
        // onAfterRender wired up inside startSequenceCapture via getDeck.
        getDeck: basemapEnabled ? undefined : () => deckRef.current,
        directoryHandle: rendersDir,
        format: sequenceFormat,
        captureDelay,
        captureMode,
        waitForData,
        startFrame: Math.floor((inPoint ?? 0) * framerate),
        endFrame: Math.floor((outPoint ?? sequenceLength) * framerate),
        onFrameStart: (frame, total) => debugRender('Exporting frame %d/%d', frame + 1, total),
        onFrameComplete: (frame, total) => {
          setRenderProgress(frame, total)
          debugRender('Completed frame %d/%d', frame, total)
        },
      })
    } catch (e) {
      // The frames written so far stay in the folder; say why the rest are missing
      alert(`Export failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [
    startSequenceCapture,
    getDeckCanvas,
    sequenceLength,
    inPoint,
    outPoint,
    framerate,
    captureDelay,
    captureMode,
    waitForData,
    rendersDirectory,
    sequenceFormat,
    basemapEnabled,
    currentDirectory,
    activeStorageType,
  ])

  // Increase the render target resolution to increase map tile detail.
  // To convert viewport bounds back to their original size, add about 1 to the zoom value.
  const lodResolution = calculateRenderSurfaceSize(resolution, lod)

  // Use fixed resolution for 'fixed' display mode, undefined for 'responsive' mode to use natural dimensions
  const isFixedMode = renderSettings.display === 'fixed'
  const displayResolution = isFixedMode ? lodResolution : undefined
  const renderWidth = lodResolution.width
  const renderHeight = lodResolution.height

  // Publish the render surface size so operators that fit content to the output
  // (e.g. BoundingBoxOp) match what is rendered, in both fixed and responsive modes
  useLayoutEffect(() => {
    if (isFixedMode) {
      setRenderSurfaceSize({ width: renderWidth, height: renderHeight })
      return
    }

    const surface = renderSurfaceRef.current
    if (!surface) return
    return observeRenderSurface(surface, setRenderSurfaceSize)
  }, [isFixedMode, renderWidth, renderHeight])

  // MapLibre follows its container through a ResizeObserver throttled to 50 ms, so it can
  // draw a frame or more at the old size after the LOD or resolution changes, while the
  // interleaved deck shares its canvas. Resize it in the same commit as its container (#728).
  const displayWidth = displayResolution?.width
  const displayHeight = displayResolution?.height
  // biome-ignore lint/correctness/useExhaustiveDependencies: resize only when the map container size changes
  useLayoutEffect(() => {
    const map = mapRef.current
    if (!basemapEnabled || !map) return
    map.resize()
    map.triggerRepaint()
  }, [displayWidth, displayHeight])

  const renderContent = () => {
    const content = basemapEnabled ? (
      <ReactMapGL style={displayResolution} {...mapProps}>
        <DeckGLOverlay
          ref={deckRef}
          renderer={renderSettings}
          isRendering={isRendering}
          {...deckProps}
        />
        {/* Interactive Draw and Measure tools, armed from the top shelf */}
        <MapToolLayer mapRef={mapRef} basemapEnabled isRendering={isRendering} />
      </ReactMapGL>
    ) : (
      <DeckGL
        ref={ref => setRef(deckRef, ref?.deck)}
        {...deckProps}
        {...(displayResolution || {})}
      />
    )
    return (
      <div ref={renderSurfaceRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
        {content}
      </div>
    )
  }

  const topBar = (
    <TopMenuBar
      projectName={noodles.projectName}
      versionedProjectName={noodles.versionedProjectName}
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
      autoLayoutOnConnect={noodles.autoLayoutOnConnect}
      onChangeAutoLayoutOnConnect={noodles.onChangeAutoLayoutOnConnect}
      spreadsheetVisible={noodles.spreadsheetVisible}
      onChangeSpreadsheetVisible={noodles.onChangeSpreadsheetVisible}
    />
  )

  return (
    <ReactFlowProvider>
      <ExportActionsProvider
        startRender={startRender}
        takeScreenshot={takeScreenshot}
        exportSequence={exportSequence}
        selectRendersDirectory={selectRendersDirectory}
        isRendering={isRendering}
      >
        <Layout
          top={topBar}
          left={nodeSidebar}
          right={propertiesPanel}
          timeline={heightPx => (
            <TimelinePanel height={heightPx} onCollapse={() => setTimelineExpanded(false)} />
          )}
          flowGraph={flowGraph}
          spreadsheet={<SpreadsheetPane selectedNodeIds={selectedNodeIds ?? []} />}
        >
          {cameraControl.reason && (
            <div className={s.cameraControlStatus} role="status">
              {cameraControl.reason}
            </div>
          )}
          {isFixedMode ? (
            <TransformScale
              scale={renderSettings.scaleControl}
              scaleMode={renderSettings.scaleMode}
              width={lodResolution.width}
              height={lodResolution.height}
            >
              <ErrorBoundary title="Visualization Error">{renderContent()}</ErrorBoundary>
            </TransformScale>
          ) : (
            <ErrorBoundary title="Visualization Error">{renderContent()}</ErrorBoundary>
          )}
        </Layout>
        {chatPanel}
        {gitHistoryPanel}
      </ExportActionsProvider>
    </ReactFlowProvider>
  )
}
