import { assert, type Deck } from '@deck.gl/core'
import { useCallback, useRef, useState } from 'react'
import { getTimelineStore, useTimelineStore } from '../timeline/timeline-store'
import { debugRender, debugRenderFrame } from '../utils/debug'

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
  const { setPosition } = getTimelineStore()

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

        const { EncodedPacket, EncodedVideoPacketSource, Mp4OutputFormat, Output, StreamTarget } =
          await import('mediabunny')

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

      // Seek to start frame and wait for render to complete before capturing.
      // This prevents stale frames from being encoded if the playhead was
      // at a different position when render started.
      const warmupSimTime = startFrame / fps
      setPosition(warmupSimTime)
      redraw()

      const warmupResult = await canvasFrameReady()
      if (warmupResult?.error) {
        debugRender('Error during render warmup:', warmupResult.error)
        setIsRendering(false)
        return
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
        const canvasResult = await canvasFrameReady()
        const waitEnd = performance.now()
        totalWaitTime += waitEnd - waitStart

        if (canvasResult?.error) {
          debugRender('Error capturing canvas frame:', canvasResult.error)
          return
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
          const result = await recorder.reader.read()
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
      finishEncoding()
      setIsRendering(false)
    },
    [projectName, sequenceLength, fps, bitrate, bitrateMode, canvasFrameReady, redraw, setPosition]
  )

  // Image sequence export — same frame loop as video capture, writes individual PNGs.
  const startSequenceCapture = useCallback(
    async ({
      canvas,
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
            setTimeout(() => captureFrame(), 16)
          },
        })
      }

      // Use captureStream + requestFrame to read from the browser compositor rather than
      // the raw GL framebuffer (which is cleared after the buffer swap when
      // preserveDrawingBuffer is false).
      const track = canvas.captureStream(0).getVideoTracks()[0]
      const mediaProcessor = new MediaStreamTrackProcessor({ track })
      const reader = mediaProcessor.readable.getReader()

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
          await canvasFrameReady()
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
          const { value: frame } = await reader.read()
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

          onFrameComplete?.(i - startFrame + 1, totalFrames)

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
      } finally {
        reader.releaseLock()
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
  quality = 1
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
}
