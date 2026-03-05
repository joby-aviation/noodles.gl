import { assert, type Deck } from '@deck.gl/core'
import {
  EncodedPacket,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  Output,
  StreamTarget,
} from 'mediabunny'
import { useCallback, useRef, useState } from 'react'
import type { ExrCompression, ImageFormat } from '../noodles/utils/serialization'
import { getTimelineStore, useTimelineStore } from '../timeline/timeline-store'
import { debugRender, debugRenderFrame } from '../utils/debug'
import { captureExrFrame, captureJpegFrame, capturePngFrame } from './exr-export'

export const rafDriver = {
  tick: (_timestamp: number) => {},
}

function useSequenceLength() {
  return useTimelineStore(state => state.sequence.length)
}

export const useRenderer = ({
  projectName = 'render',
  fps = 30,
  bitrate = 10_000_000, // 10mbps
  bitrateMode,
  redraw,
}: {
  projectName?: string
  fps?: number
  bitrate?: number
  bitrateMode: 'variable' | 'constant'
  redraw: () => void
}) => {
  // Get sequence length from the appropriate timeline system
  const sequenceLength = useSequenceLength()

  const canvasRenderDone = useRef<(result?: { error?: Error }) => void>(() => {})
  const canvasFrameReady = useCallback(
    () =>
      new Promise<{ error?: Error } | undefined>(resolve => {
        canvasRenderDone.current = resolve
      }),
    []
  )
  // The reference always points to the latest value, so the closure can't get stale
  const captureFrame = useCallback((result?: { error?: Error }) => {
    canvasRenderDone.current(result)
  }, [])

  const currentFrame = useRef(0)

  const startCapture = useCallback(
    async ({
      canvas,
      width,
      height,
      codec,
      startFrame = 0,
      endFrame = Math.floor(sequenceLength * fps),
    }: {
      canvas: HTMLCanvasElement
      width: number
      height: number
      codec: 'hevc' | 'avc' | 'vp9' | 'av1'
      startFrame?: number
      endFrame?: number
    }) => {
      assert(canvas, 'canvas is required')

      let i = startFrame

      setIsRendering(true)

      const getContainer = async (name: string) => {
        const fileHandle = await window
          .showSaveFilePicker({
            suggestedName: `${name}.mp4`,
            types: [
              {
                description: 'Video File',
                accept: { 'video/mp4': ['.mp4'] },
              },
            ],
          })
          .catch(error => {
            if (error.name === 'AbortError') {
              debugRender('File picker cancelled by user for: %s', name)
            } else {
              debugRender('Error in showSaveFilePicker for', name, ':', error)
            }
            return null // Signal cancellation/failure
          })

        if (!fileHandle) {
          return null
        }
        const fileWritableStream = await fileHandle.createWritable()

        const output = new Output({
          format: new Mp4OutputFormat({
            fastStart: 'in-memory',
          }),
          target: new StreamTarget(
            fileWritableStream as WritableStream<{
              type: 'write'
              data: Uint8Array
              position: number
            }>,
            { chunked: true }
          ),
        })

        const videoSource = new EncodedVideoPacketSource(codec)
        output.addVideoTrack(videoSource, {
          frameRate: fps,
        })

        let currentFrameIndex = startFrame
        const videoEncoder = new VideoEncoder({
          output: (chunk, meta) => {
            // Use the simulated time as the timestamp, not the VideoFrame's real-time timestamp
            const timestamp = currentFrameIndex / fps
            const duration = 1 / fps
            const packet = EncodedPacket.fromEncodedChunk(chunk)
            // Clone the packet with the correct timestamp
            const correctedPacket = packet.clone({ timestamp, duration })
            videoSource.add(correctedPacket, meta)
            currentFrameIndex++
          },
          error: e => debugRender(e),
        })

        const codecMap = {
          hevc: {
            codec: 'hev1.1.6.L123.00',
            hevc: { format: 'annexb' },
          },
          avc: {
            codec: 'avc1.42003e',
          },
          vp9: {
            codec: 'vp09.00.10.08',
          },
          av1: {
            codec: 'v01.0.08M.10.0.110.09',
          },
        } as const

        const config = {
          width,
          height,
          bitrate,
          bitrateMode,
          hardwareAcceleration: 'prefer-hardware',
          framerate: fps,
          ...codecMap[codec],
        } as const

        const { supported } = await VideoEncoder.isConfigSupported(config)

        if (!supported) {
          debugRender('Unsupported codec configuration', config)
          debugger
        }

        videoEncoder.configure(config)

        async function encodeFrame(data: VideoFrame) {
          const keyFrame = i % 60 === 0
          videoEncoder.encode(data, { keyFrame })
        }

        await output.start()

        async function finishEncoding() {
          await videoEncoder.flush()
          videoSource.close()
          await output.finalize()
        }

        return {
          videoEncoder,
          encodeFrame,
          output,
          videoSource,
          finishEncoding,
        }
      }

      function getCanvasRecorder(canvas: HTMLCanvasElement) {
        const track = canvas.captureStream(0).getVideoTracks()[0]
        const mediaProcessor = new MediaStreamTrackProcessor({ track })
        const reader = mediaProcessor.readable.getReader()
        return { track, reader }
      }

      const mapContainer = await getContainer(`${projectName}-map`)
      if (!mapContainer) {
        setIsRendering(false)
        debugRender('Render setup cancelled by user (map container)')
        return
      }
      const containers = new Map([['map', mapContainer]])

      const mapRecorder = getCanvasRecorder(canvas)

      async function finishEncoding() {
        for (const container of containers.values()) {
          await container.finishEncoding()
        }
        mapRecorder?.reader?.releaseLock()
      }

      for (; i < endFrame + 1; i++) {
        const simTime = i / fps
        getTimelineStore().setPosition(simTime)
        redraw()

        currentFrame.current = i
        if (i % 10 === 0)
          debugRenderFrame('capturing frame %d/%d at simtime %d', i, endFrame, simTime)

        const canvasResult = await canvasFrameReady()

        if (canvasResult?.error) {
          debugRender('Error capturing canvas frame:', canvasResult.error)
          return
        }

        const addRecorderFrame = async (
          recorder: ReturnType<typeof getCanvasRecorder>,
          container: Awaited<ReturnType<typeof getContainer>>
        ) => {
          // @ts-expect-error - typescript types not updated yet
          recorder.track.requestFrame()
          const result = await recorder.reader.read()
          const frame = result.value

          assert(frame, 'frame is required - might be a problem with the browser')

          await container?.encodeFrame(frame)
          frame.close()
        }

        await addRecorderFrame(mapRecorder, mapContainer)
      }
      finishEncoding()
      setIsRendering(false)
    },
    [projectName, sequenceLength, fps, bitrate, bitrateMode, canvasFrameReady, redraw]
  )

  // Image sequence export - uses the same render loop as video capture but writes individual images
  const startSequenceCapture = useCallback(
    async ({
      canvas,
      getGLContext,
      getDeck,
      directoryHandle,
      format = 'png',
      exrCompression = 'zip',
      includeDepth = false,
      captureDelay = 200,
      waitForData = true,
      startFrame = 0,
      endFrame = Math.floor(sequenceLength * fps),
      onFrameStart,
      onFrameComplete,
      onError,
    }: {
      canvas: HTMLCanvasElement
      getGLContext: () => WebGL2RenderingContext | null
      getDeck?: () => Deck | null
      directoryHandle: FileSystemDirectoryHandle
      format?: ImageFormat
      exrCompression?: ExrCompression
      includeDepth?: boolean
      captureDelay?: number
      waitForData?: boolean
      startFrame?: number
      endFrame?: number
      onFrameStart?: (frame: number, total: number) => void
      onFrameComplete?: (frame: number, total: number) => void
      onError?: (error: Error, frame: number) => void
    }) => {
      assert(canvas, 'canvas is required')
      assert(directoryHandle, 'directoryHandle is required')

      setIsRendering(true)

      const totalFrames = endFrame - startFrame + 1
      const padLength = Math.max(4, String(endFrame).length)
      const extension = format === 'exr' ? 'exr' : format === 'jpeg' ? 'jpg' : 'png'

      // For pure Deck scenes (no basemap), set up our own persistent onAfterRender callback.
      // This mirrors how basemap scenes work where mapProps.onIdle fires every frame.
      const deck = getDeck?.()
      const originalOnAfterRender = deck?.props.onAfterRender

      const isDeckReady = () =>
        !deck ||
        deck.props.layers.every(layer => !layer || (!Array.isArray(layer) && layer.isLoaded))

      if (deck) {
        deck.setProps({
          onAfterRender: context => {
            originalOnAfterRender?.(context)
            // Check if layers are loaded when waitForData is enabled
            if (waitForData && !isDeckReady()) {
              debugRender('deck waiting for layers to load')
              return
            }
            // Signal frame is ready after captureDelay
            setTimeout(() => captureFrame(), captureDelay)
          },
        })
      }

      // Writes are pipelined: each frame's file write runs concurrently with the next render.
      // This avoids blocking the render loop on writable.close(), which flushes to disk (~750ms/frame).
      // A bounded queue prevents unbounded memory accumulation.
      const MAX_CONCURRENT_WRITES = 4
      const pendingWrites: Promise<void>[] = []

      const writeFile = (filename: string, data: Uint8Array | Blob): Promise<void> =>
        directoryHandle
          .getFileHandle(filename, { create: true })
          .then(fh => fh.createWritable())
          .then(async writable => {
            await writable.write(data)
            await writable.close()
          })

      try {
        for (let i = startFrame; i < endFrame + 1; i++) {
          onFrameStart?.(i - startFrame, totalFrames)

          try {
            // Set sequence position and render frame
            const simTime = i / fps
            getTimelineStore().setPosition(simTime)
            redraw()

            currentFrame.current = i
            if (i % 10 === 0)
              debugRenderFrame('exporting frame %d/%d at simtime %d', i, endFrame, simTime)

            // Wait for frame to be ready (resolved by onAfterRender callback for pure deck,
            // or by mapProps.onIdle for basemap scenes)
            await canvasFrameReady()

            // Generate filename
            const frameNumber = String(i).padStart(padLength, '0')
            const filename = `${projectName}_${frameNumber}.${extension}`

            // Drain oldest write if the queue is full before capturing the next frame
            if (pendingWrites.length >= MAX_CONCURRENT_WRITES) {
              await pendingWrites.shift()
            }

            // Capture frame data and enqueue the write without awaiting it.
            // For EXR, captureExrFrame is synchronous so pixels are captured before the GL
            // context changes. For PNG/JPEG, toBlob must finish before we can move on, but
            // the subsequent file write is still pipelined.
            if (format === 'exr') {
              const gl = getGLContext()
              if (!gl) {
                throw new Error('WebGL context not available for EXR export')
              }
              const exrData = captureExrFrame(gl, canvas.width, canvas.height, {
                compression: exrCompression,
                includeDepth,
              })
              pendingWrites.push(writeFile(filename, exrData))
            } else {
              // PNG or JPEG: toBlob must complete before GL context changes, but the
              // resulting file write runs concurrently with the next frame's render.
              const blob =
                format === 'jpeg'
                  ? await captureJpegFrame(canvas, 0.92)
                  : await capturePngFrame(canvas, 1)
              pendingWrites.push(writeFile(filename, blob))
            }

            onFrameComplete?.(i - startFrame + 1, totalFrames)
          } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e))
            onError?.(error, i)
            debugRender('Error exporting frame %d: %o', i, error)
          }
        }

        // Wait for all in-flight writes to complete before finishing
        await Promise.all(pendingWrites)
      } finally {
        // Restore original callback after loop completes
        if (deck) {
          deck.setProps({
            onAfterRender: originalOnAfterRender ?? (() => {}),
          })
        }
        setIsRendering(false)
      }
    },
    [projectName, sequenceLength, fps, redraw, canvasFrameReady, captureFrame]
  )

  const [isRendering, setIsRendering] = useState(false)

  return {
    startCapture,
    startSequenceCapture,
    captureFrame,
    currentFrame: currentFrame.current,
    isRendering,
  }
}

export default useRenderer

export interface ScreenshotOptions {
  format?: ImageFormat
  quality?: number
  exrCompression?: ExrCompression
  includeDepth?: boolean
  getGLContext?: () => WebGL2RenderingContext | null
}

export const captureScreenshot = async (
  suggestedName: string,
  getBufferedCanvas: () => HTMLCanvasElement,
  options: ScreenshotOptions = {}
) => {
  const {
    format = 'png',
    quality = 1,
    exrCompression = 'zip',
    includeDepth = false,
    getGLContext,
  } = options

  if (format === 'exr') {
    // EXR export path - requires GL context for float readPixels
    if (!getGLContext) {
      throw new Error('EXR export requires WebGL context accessor (getGLContext)')
    }

    const gl = getGLContext()
    if (!gl) {
      throw new Error('WebGL context not available for EXR export')
    }

    const imageHandle = await window.showSaveFilePicker({
      suggestedName: `${suggestedName}.exr`,
      types: [{ description: 'OpenEXR', accept: { 'image/x-exr': ['.exr'] } }],
    })

    // Redraw to ensure buffer is populated
    const canvas = getBufferedCanvas()

    const exrData = captureExrFrame(gl, canvas.width, canvas.height, {
      compression: exrCompression,
      includeDepth,
    })

    const fileWritableStream = await imageHandle.createWritable()
    await fileWritableStream.write(exrData)
    await fileWritableStream.close()
  } else {
    // PNG/JPEG path - use existing canvas.toBlob approach
    const extension = format === 'jpeg' ? '.jpeg' : '.png'
    const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png'

    const imageHandle = await window.showSaveFilePicker({
      suggestedName: `${suggestedName}${extension}`,
      types: [
        {
          description: format.toUpperCase(),
          accept: { [mimeType]: [extension] },
        },
      ],
    })

    // Redraw to ensure buffer is populated
    const canvas = getBufferedCanvas()

    const blob =
      format === 'jpeg'
        ? await captureJpegFrame(canvas, quality)
        : await capturePngFrame(canvas, quality)

    const fileWritableStream = await imageHandle.createWritable()
    await fileWritableStream.write(blob)
    await fileWritableStream.close()
  }
}
