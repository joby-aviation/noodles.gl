import { assert, type Deck } from '@deck.gl/core'
import { useCallback, useRef, useState } from 'react'
import { getTimelineStore, useTimelineStore } from '../timeline/timeline-store'
import { analytics } from '../utils/analytics'
import { debugRender, debugRenderFrame } from '../utils/debug'
import {
  CanvasReplacedError,
  FRAME_READ_TIMEOUT_MS,
  FRAME_READY_TIMEOUT_MS,
  FrameTimeoutError,
  guardFrameStep,
} from './frame-guard'
import { type RenderErrorCategory, type RenderSource, trackRender } from './render-analytics'

export const rafDriver = {
  tick: (_timestamp: number) => {},
}

export type VideoCodec = 'hevc' | 'avc' | 'vp9' | 'av1'

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
    codec: 'av01.0.08M.08',
  },
} as const

// Hardware first, because it is faster. Software second, because some machines have
// no hardware encoder for a codec at all (VP9 on a Mac), and asking for hardware then
// fails the check even though the software encoder would work.
export async function resolveEncoderConfig(
  base: Omit<VideoEncoderConfig, 'hardwareAcceleration'>
): Promise<VideoEncoderConfig | null> {
  for (const hardwareAcceleration of ['prefer-hardware', 'no-preference'] as const) {
    const config = { ...base, hardwareAcceleration }
    const { supported } = await VideoEncoder.isConfigSupported(config)
    if (supported) return config
    debugRender('Unsupported codec configuration', config)
  }
  return null
}

// 'picker' asks the user where to save (the Export button). 'buffer' keeps the MP4
// in memory and returns it, for callers that cannot show a picker: the browser only
// opens one in response to a click, so an agent driving the editor never could.
export type CaptureTarget = 'picker' | 'buffer'

export type CaptureResult =
  | { status: 'done'; frameCount: number; fps: number; buffer?: ArrayBuffer }
  | { status: 'cancelled' }
  | { status: 'error'; error: Error }

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
  const { setPosition } = getTimelineStore()

  const startCapture = useCallback(
    async ({
      canvas,
      getCanvas = () => canvas,
      width,
      height,
      codec,
      fps: captureFps = fps,
      startFrame = 0,
      endFrame = Math.floor(sequenceLength * captureFps),
      target = 'picker',
      source = 'menu',
      onFrameComplete,
    }: {
      canvas: HTMLCanvasElement
      // The canvas being drawn now, to notice when the recorded one is replaced
      getCanvas?: () => HTMLCanvasElement | null | undefined
      width: number
      height: number
      codec: VideoCodec
      fps?: number
      startFrame?: number
      endFrame?: number
      target?: CaptureTarget
      source?: RenderSource
      onFrameComplete?: (frame: number, total: number) => void
    }): Promise<CaptureResult> => {
      assert(canvas, 'canvas is required')

      let i = startFrame
      const fps = captureFps

      const tracker = trackRender({
        source,
        format: 'mp4',
        codec,
        width,
        height,
        frameCount: endFrame - startFrame + 1,
      })
      const fail = (category: RenderErrorCategory, error: Error): CaptureResult => {
        tracker.failed(category, error, i - startFrame)
        return { status: 'error', error }
      }

      setIsRendering(true)

      // The first encoder error, reported when the export finishes. The encoder
      // reports errors through a callback, so they would otherwise only be logged.
      let encoderError: Error | undefined

      const pickFileStream = async (name: string) => {
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
            // Only the user closing the dialog is a cancellation. Anything else, such as
            // the browser refusing to open it, fails the export.
            if (error.name !== 'AbortError') throw error
            debugRender('File picker cancelled by user for: %s', name)
            return null
          })

        if (!fileHandle) {
          return null
        }

        return fileHandle.createWritable()
      }

      const getContainer = async (name: string, config: VideoEncoderConfig) => {
        // The picker comes first: it needs the click that started the export, and the
        // browser only honors that click for a few seconds
        const fileWritableStream = target === 'picker' ? await pickFileStream(name) : null
        if (target === 'picker' && !fileWritableStream) {
          return null
        }

        const {
          BufferTarget,
          EncodedPacket,
          EncodedVideoPacketSource,
          Mp4OutputFormat,
          Output,
          StreamTarget,
        } = await import('mediabunny')

        const outputTarget = fileWritableStream
          ? new StreamTarget(
              fileWritableStream as WritableStream<{
                type: 'write'
                data: Uint8Array
                position: number
              }>,
              { chunked: true }
            )
          : new BufferTarget()

        const output = new Output({
          format: new Mp4OutputFormat({
            fastStart: 'in-memory',
          }),
          target: outputTarget,
        })

        const videoSource = new EncodedVideoPacketSource(codec)
        output.addVideoTrack(videoSource, {
          frameRate: fps,
        })

        let currentFrameIndex = 0
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
          error: e => {
            debugRender(e)
            encoderError ??= e
          },
        })

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
          return outputTarget instanceof BufferTarget
            ? (outputTarget.buffer ?? undefined)
            : undefined
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

      try {
        // Checked before the save dialog, so a codec the browser refuses does not leave
        // an empty file behind. The check takes milliseconds, well inside the few
        // seconds the click that opens the dialog stays valid.
        const config = await resolveEncoderConfig({
          width,
          height,
          bitrate,
          bitrateMode,
          framerate: fps,
          ...codecMap[codec],
        })
        if (!config) {
          return fail(
            'unsupported_codec',
            new Error(
              `This browser cannot encode ${codec} at ${width}x${height}. Try another codec or a smaller resolution.`
            )
          )
        }

        const mapContainer = await getContainer(`${projectName}-map`, config)
        if (!mapContainer) {
          debugRender('Render setup cancelled by user (map container)')
          tracker.cancelled()
          return { status: 'cancelled' }
        }
        tracker.restartClock()

        const mapRecorder = getCanvasRecorder(canvas)
        const guard = { recording: canvas, getCanvas }

        const finishEncoding = async () => {
          const buffer = await mapContainer.finishEncoding()
          mapRecorder?.reader?.releaseLock()
          return buffer
        }

        // Seek to start frame and wait for render to complete before capturing.
        // This prevents stale frames from being encoded if the playhead was
        // at a different position when render started.
        const warmupSimTime = startFrame / fps
        setPosition(warmupSimTime)
        redraw()

        const warmupResult = await guardFrameStep(
          canvasFrameReady(),
          guard,
          FRAME_READY_TIMEOUT_MS,
          `The first frame did not finish drawing within ${FRAME_READY_TIMEOUT_MS / 1000}s`
        )
        if (warmupResult?.error) {
          debugRender('Error during render warmup:', warmupResult.error)
          mapRecorder.reader.releaseLock()
          return fail('frame', warmupResult.error)
        }

        const frameStartTime = performance.now()
        let totalWaitTime = 0
        let totalCaptureTime = 0
        let totalEncodeTime = 0

        for (; i < endFrame + 1; i++) {
          const frameIterationStart = performance.now()
          const simTime = i / fps
          setPosition(simTime)
          redraw()

          currentFrame.current = i
          if (i % 10 === 0)
            debugRenderFrame('capturing frame %d/%d at simtime %d', i, endFrame, simTime)

          const waitStart = performance.now()
          const canvasResult = await guardFrameStep(
            canvasFrameReady(),
            guard,
            FRAME_READY_TIMEOUT_MS,
            `Frame ${i} did not finish drawing within ${FRAME_READY_TIMEOUT_MS / 1000}s`
          )
          const waitEnd = performance.now()
          totalWaitTime += waitEnd - waitStart

          if (canvasResult?.error) {
            debugRender('Error capturing canvas frame:', canvasResult.error)
            mapRecorder.reader.releaseLock()
            return fail('frame', canvasResult.error)
          }

          // Lift timing variables outside closure for per-frame logging
          let captureStart = 0
          let captureEnd = 0
          let encodeStart = 0
          let encodeEnd = 0

          const addRecorderFrame = async (
            recorder: ReturnType<typeof getCanvasRecorder>,
            container: Awaited<ReturnType<typeof getContainer>>
          ) => {
            captureStart = performance.now()
            // @ts-expect-error - typescript types not updated yet
            recorder.track.requestFrame()
            const result = await guardFrameStep(
              recorder.reader.read(),
              guard,
              FRAME_READ_TIMEOUT_MS,
              `Frame ${i} could not be read from the canvas within ${FRAME_READ_TIMEOUT_MS / 1000}s`
            )
            captureEnd = performance.now()
            totalCaptureTime += captureEnd - captureStart

            const frame = result.value

            assert(frame, 'frame is required - might be a problem with the browser')

            encodeStart = performance.now()
            await container?.encodeFrame(frame)
            encodeEnd = performance.now()
            totalEncodeTime += encodeEnd - encodeStart

            frame.close()
          }

          await addRecorderFrame(mapRecorder, mapContainer)
          onFrameComplete?.(i - startFrame + 1, endFrame - startFrame + 1)

          if (i % 10 === 0) {
            const frameIterationEnd = performance.now()
            const frameTime = frameIterationEnd - frameIterationStart
            debugRenderFrame(
              'frame %d timing: total=%dms wait=%dms capture=%dms encode=%dms',
              i,
              frameTime.toFixed(1),
              (waitEnd - waitStart).toFixed(1),
              (captureEnd - captureStart).toFixed(1),
              (encodeEnd - encodeStart).toFixed(1)
            )
          }
        }

        const totalTime = performance.now() - frameStartTime
        const frameCount = endFrame - startFrame + 1
        const avgFrameTime = totalTime / frameCount
        const targetFrameTime = 1000 / fps
        const speedFactor = targetFrameTime / avgFrameTime

        debugRender(
          'Export complete: %d frames in %dms (avg %dms/frame, target %dms/frame, %dx realtime speed)',
          frameCount,
          totalTime.toFixed(0),
          avgFrameTime.toFixed(1),
          targetFrameTime.toFixed(1),
          speedFactor.toFixed(2)
        )
        debugRender(
          'Time breakdown: wait=%dms (%.1f%%), capture=%dms (%.1f%%), encode=%dms (%.1f%%)',
          totalWaitTime.toFixed(0),
          (totalWaitTime / totalTime) * 100,
          totalCaptureTime.toFixed(0),
          (totalCaptureTime / totalTime) * 100,
          totalEncodeTime.toFixed(0),
          (totalEncodeTime / totalTime) * 100
        )
        const buffer = await finishEncoding()
        if (encoderError) return fail('encoder', encoderError)
        tracker.completed()
        return { status: 'done', frameCount, fps, buffer }
      } catch (error) {
        debugRender('Render failed:', error)
        // After an encoder error the encoder closes, so the next encode() or flush()
        // throws. The encoder's own error says what went wrong.
        if (encoderError) return fail('encoder', encoderError)
        if (error instanceof CanvasReplacedError) return fail('canvas_replaced', error)
        if (error instanceof FrameTimeoutError) return fail('timeout', error)
        return fail('exception', error instanceof Error ? error : new Error(String(error)))
      } finally {
        setIsRendering(false)
      }
    },
    [projectName, sequenceLength, fps, bitrate, bitrateMode, canvasFrameReady, redraw, setPosition]
  )

  // Image sequence export — same frame loop as video capture, writes individual PNGs.
  const startSequenceCapture = useCallback(
    async ({
      canvas,
      getCanvas = () => canvas,
      getDeck,
      directoryHandle,
      captureDelay = 200,
      waitForData = true,
      startFrame = 0,
      endFrame = Math.floor(sequenceLength * fps),
      onFrameStart,
      onFrameComplete,
    }: {
      canvas: HTMLCanvasElement
      // The canvas being drawn now, to notice when the recorded one is replaced
      getCanvas?: () => HTMLCanvasElement | null | undefined
      getDeck?: () => Deck | null
      directoryHandle: FileSystemDirectoryHandle
      captureDelay?: number
      waitForData?: boolean
      startFrame?: number
      endFrame?: number
      onFrameStart?: (frame: number, total: number) => void
      onFrameComplete?: (frame: number, total: number) => void
    }) => {
      assert(canvas, 'canvas is required')
      assert(directoryHandle, 'directoryHandle is required')

      setIsRendering(true)

      const totalFrames = endFrame - startFrame + 1
      const padLength = Math.max(4, String(endFrame).length)

      // Frames are captured at the canvas's own size
      const tracker = trackRender({
        source: 'menu',
        format: 'png_sequence',
        width: canvas.width,
        height: canvas.height,
        frameCount: totalFrames,
      })
      let framesDone = 0

      // For pure-deck scenes (no basemap), install a temporary onAfterRender that fires captureFrame().
      // Basemap scenes already drive frame readiness via mapProps.onIdle.
      const deck = getDeck?.()
      const originalOnAfterRender = deck?.props.onAfterRender

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
            setTimeout(() => captureFrame(), captureDelay)
          },
        })
      }

      let reader: ReadableStreamDefaultReader<VideoFrame> | undefined

      // Pipelined writes: up to MAX_CONCURRENT_WRITES file writes run concurrently with
      // the next frame's render to avoid ~750ms/frame disk flush stalls.
      const MAX_CONCURRENT_WRITES = 4
      const pendingWrites: Promise<void>[] = []

      const writeFile = (filename: string, data: Blob): Promise<void> =>
        directoryHandle
          .getFileHandle(filename, { create: true })
          .then(fh => fh.createWritable())
          .then(async writable => {
            await writable.write(data)
            await writable.close()
          })

      try {
        // Use captureStream + requestFrame to read from the browser compositor rather than
        // the raw GL framebuffer (which is cleared after the buffer swap when
        // preserveDrawingBuffer is false). Inside the try: captureStream throws on a
        // canvas with cross-origin content.
        const track = canvas.captureStream(0).getVideoTracks()[0]
        const mediaProcessor = new MediaStreamTrackProcessor({ track })
        reader = mediaProcessor.readable.getReader()
        const guard = { recording: canvas, getCanvas }

        const exportStartTime = performance.now()
        let totalWaitTime = 0
        let totalCaptureTime = 0
        let totalConvertTime = 0

        for (let i = startFrame; i < endFrame + 1; i++) {
          onFrameStart?.(i - startFrame, totalFrames)

          const frameIterationStart = performance.now()
          const simTime = i / fps
          setPosition(simTime)
          redraw()

          currentFrame.current = i
          if (i % 10 === 0)
            debugRenderFrame('exporting frame %d/%d at simtime %d', i, endFrame, simTime)

          // Wait for frame to be ready (onAfterRender for pure-deck, onIdle for basemap)
          const waitStart = performance.now()
          await guardFrameStep(
            canvasFrameReady(),
            guard,
            FRAME_READY_TIMEOUT_MS,
            `Frame ${i} did not finish drawing within ${FRAME_READY_TIMEOUT_MS / 1000}s`
          )
          const waitEnd = performance.now()
          totalWaitTime += waitEnd - waitStart

          const frameNumber = String(i).padStart(padLength, '0')
          const filename = `${projectName}_${frameNumber}.png`

          // Drain oldest write if the queue is full before capturing the next frame
          if (pendingWrites.length >= MAX_CONCURRENT_WRITES) {
            await pendingWrites.shift()
          }

          // Capture via compositor: requestFrame reads from the display buffer, not the
          // GL buffer (which may already be cleared). Draw into OffscreenCanvas for PNG.
          const captureStart = performance.now()
          // @ts-expect-error - typescript types not updated yet
          track.requestFrame()
          const { value: frame } = await guardFrameStep(
            reader.read(),
            guard,
            FRAME_READ_TIMEOUT_MS,
            `Frame ${i} could not be read from the canvas within ${FRAME_READ_TIMEOUT_MS / 1000}s`
          )
          const captureEnd = performance.now()
          totalCaptureTime += captureEnd - captureStart

          assert(frame, 'frame is required - might be a problem with the browser')

          const convertStart = performance.now()
          const offscreen = new OffscreenCanvas(frame.displayWidth, frame.displayHeight)
          const ctx = offscreen.getContext('2d')!
          ctx.drawImage(frame, 0, 0)
          frame.close()
          const blob = await offscreen.convertToBlob({ type: 'image/png' })
          const convertEnd = performance.now()
          totalConvertTime += convertEnd - convertStart

          pendingWrites.push(writeFile(filename, blob))

          framesDone = i - startFrame + 1
          onFrameComplete?.(framesDone, totalFrames)

          if (i % 10 === 0) {
            const frameIterationEnd = performance.now()
            const frameTime = frameIterationEnd - frameIterationStart
            debugRenderFrame(
              'frame %d timing: total=%dms wait=%dms capture=%dms convert=%dms',
              i,
              frameTime.toFixed(1),
              (waitEnd - waitStart).toFixed(1),
              (captureEnd - captureStart).toFixed(1),
              (convertEnd - convertStart).toFixed(1)
            )
          }
        }

        await Promise.all(pendingWrites)

        const totalTime = performance.now() - exportStartTime
        const frameCount = endFrame - startFrame + 1
        const avgFrameTime = totalTime / frameCount
        const targetFrameTime = 1000 / fps
        const speedFactor = targetFrameTime / avgFrameTime

        debugRender(
          'Image sequence export complete: %d frames in %dms (avg %dms/frame, target %dms/frame, %dx realtime speed)',
          frameCount,
          totalTime.toFixed(0),
          avgFrameTime.toFixed(1),
          targetFrameTime.toFixed(1),
          speedFactor.toFixed(2)
        )
        debugRender(
          'Time breakdown: wait=%dms (%.1f%%), capture=%dms (%.1f%%), convert=%dms (%.1f%%)',
          totalWaitTime.toFixed(0),
          (totalWaitTime / totalTime) * 100,
          totalCaptureTime.toFixed(0),
          (totalCaptureTime / totalTime) * 100,
          totalConvertTime.toFixed(0),
          (totalConvertTime / totalTime) * 100
        )
        tracker.completed()
      } catch (error) {
        const category: RenderErrorCategory =
          error instanceof CanvasReplacedError
            ? 'canvas_replaced'
            : error instanceof FrameTimeoutError
              ? 'timeout'
              : 'exception'
        tracker.failed(
          category,
          error instanceof Error ? error : new Error(String(error)),
          framesDone
        )
        throw error
      } finally {
        reader?.releaseLock()
        if (deck) {
          deck.setProps({ onAfterRender: originalOnAfterRender ?? (() => {}) })
        }
        setIsRendering(false)
      }
    },
    [projectName, sequenceLength, fps, redraw, canvasFrameReady, captureFrame, setPosition]
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

export const captureScreenshot = async (
  suggestedName: string,
  getBufferedCanvas: () => HTMLCanvasElement,
  { quality = 1, source = 'menu' }: { quality?: number; source?: RenderSource } = {}
) => {
  const imageHandle = await window.showSaveFilePicker({
    suggestedName,
    types: [
      {
        description: 'PNG',
        accept: { 'image/png': ['.png'] },
      },
      {
        description: 'JPEG',
        accept: { 'image/jpeg': ['.jpeg'] },
      },
    ],
  })

  const file = await imageHandle.getFile()

  const blob = await new Promise<Blob>((resolve, reject) => {
    // canvas needs to redrawn immediately before capture or else buffer will be empty.
    getBufferedCanvas().toBlob(
      blob => (blob ? resolve(blob) : reject('canvas is empty')),
      file.type,
      quality
    )
  })

  const fileWritableStream = await imageHandle.createWritable()
  await fileWritableStream.write(blob)
  await fileWritableStream.close()
  analytics.track('screenshot_taken', { source })
}
