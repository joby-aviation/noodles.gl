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
import { captureDepthFromDeckFBO, captureExrFrame } from './exr-export'

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

  // Image sequence export — same frame loop as video capture, writes individual images.
  // PNG uses captureStream + MediaStreamTrackProcessor to read from the browser compositor
  // (avoids reading the raw GL framebuffer which is cleared after buffer swap).
  // EXR uses gl.readPixels directly since it needs float precision from the GL context.
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
      getGLContext?: () => WebGL2RenderingContext | null
      getDeck?: () => Deck | null
      directoryHandle: FileSystemDirectoryHandle
      format?: 'png' | 'exr'
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
      const extension = format === 'exr' ? 'exr' : 'png'

      const deck = getDeck?.()
      const originalOnAfterRender = deck?.props.onAfterRender

      // For EXR with depth, capture depth from Deck's internal FBO synchronously in
      // onAfterRender (before it is cleared). Stored here for use after canvasFrameReady().
      let capturedDepth: Float32Array | null = null

      // Tracks the pending capture timer so only one fires per logical frame.
      // Without this guard, every onAfterRender during captureDelay queues its own
      // setTimeout, and stale timers from frame N prematurely resolve frame N+1, N+2, etc.
      let captureTimer: ReturnType<typeof setTimeout> | null = null

      if (deck) {
        deck.setProps({
          onAfterRender: context => {
            originalOnAfterRender?.(context)
            if (
              waitForData &&
              !deck.props.layers.every(l => !l || (!Array.isArray(l) && l.isLoaded))
            ) {
              debugRender('deck waiting for layers to load')
              return
            }
            // Capture depth from the internal FBO before it is cleared (EXR only).
            // Must happen synchronously here, before the next render cycle.
            if (format === 'exr' && includeDepth && getGLContext) {
              const gl = getGLContext()
              if (gl) capturedDepth = captureDepthFromDeckFBO(deck, gl, canvas.width, canvas.height)
            }
            // Throttle to one scheduled captureFrame per frame: once a timer is in-flight,
            // ignore subsequent onAfterRender firings until it resolves.
            if (captureTimer !== null) return
            captureTimer = setTimeout(() => {
              captureTimer = null
              captureFrame()
            }, captureDelay)
          },
        })
      }

      // For PNG: use captureStream + requestFrame to read from the browser compositor rather
      // than the raw GL framebuffer (which is cleared after the buffer swap).
      const track = format !== 'exr' ? canvas.captureStream(0).getVideoTracks()[0] : null
      const reader = track
        ? new MediaStreamTrackProcessor({ track }).readable.getReader()
        : null

      // Pipelined writes: up to MAX_CONCURRENT_WRITES file writes run concurrently with
      // the next frame's render to avoid ~750ms/frame disk flush stalls.
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
            const simTime = i / fps
            getTimelineStore().setPosition(simTime)
            redraw()

            currentFrame.current = i
            if (i % 10 === 0)
              debugRenderFrame('exporting frame %d/%d at simtime %d', i, endFrame, simTime)

            // Wait for frame to be ready (onAfterRender for pure-deck, onIdle for basemap)
            await canvasFrameReady()

            const frameNumber = String(i).padStart(padLength, '0')
            const filename = `${projectName}_${frameNumber}.${extension}`

            if (pendingWrites.length >= MAX_CONCURRENT_WRITES) {
              await pendingWrites.shift()
            }

            if (format === 'exr') {
              const gl = getGLContext?.()
              if (!gl) throw new Error('WebGL context not available for EXR export')
              // Consume and reset depth captured in onAfterRender
              const depth = capturedDepth
              capturedDepth = null
              const exrData = captureExrFrame(gl, canvas.width, canvas.height, {
                compression: exrCompression,
                depth,
              })
              pendingWrites.push(writeFile(filename, exrData))
            } else {
              // PNG: read from compositor (display buffer, not raw GL framebuffer which may be cleared)
              // @ts-expect-error - typescript types not updated yet
              track!.requestFrame()
              const { value: frame } = await reader!.read()
              assert(frame, 'frame is required - might be a problem with the browser')
              const offscreen = new OffscreenCanvas(frame.displayWidth, frame.displayHeight)
              const ctx = offscreen.getContext('2d')!
              ctx.drawImage(frame, 0, 0)
              frame.close()
              const blob = await offscreen.convertToBlob({ type: 'image/png' })
              pendingWrites.push(writeFile(filename, blob))
            }

            onFrameComplete?.(i - startFrame + 1, totalFrames)
          } catch (e) {
            const error = e instanceof Error ? e : new Error(String(e))
            onError?.(error, i)
            debugRender('Error exporting frame %d: %o', i, error)
          }
        }

        await Promise.all(pendingWrites)
      } finally {
        if (reader) reader.releaseLock()
        if (deck) {
          deck.setProps({ onAfterRender: originalOnAfterRender ?? (() => {}) })
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
  getDeck?: () => Deck | null
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
    getDeck,
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

    // Redraw to ensure buffer is populated, then capture depth from Deck's internal FBO
    const canvas = getBufferedCanvas()

    let depth: Float32Array | null = null
    if (includeDepth && getDeck) {
      const deck = getDeck()
      if (deck) depth = captureDepthFromDeckFBO(deck, gl, canvas.width, canvas.height)
    }

    const exrData = captureExrFrame(gl, canvas.width, canvas.height, {
      compression: exrCompression,
      depth,
    })

    const fileWritableStream = await imageHandle.createWritable()
    await fileWritableStream.write(exrData)
    await fileWritableStream.close()
  } else {
    // PNG/JPEG path
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

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        b => (b ? resolve(b) : reject(new Error('Canvas is empty'))),
        mimeType,
        format === 'jpeg' ? quality : undefined
      )
    })

    const fileWritableStream = await imageHandle.createWritable()
    await fileWritableStream.write(blob)
    await fileWritableStream.close()
  }
}
