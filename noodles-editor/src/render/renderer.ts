import { assert } from '@deck.gl/core'
import { createRafDriver, type IProject, type ISequence } from '@theatre/core'
import { useVal } from '@theatre/react'
import {
  EncodedPacket,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  Output,
  StreamTarget,
} from 'mediabunny'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ExrCompression, ImageFormat } from '../noodles/utils/serialization'
import { captureExrFrame, captureJpegFrame, capturePngFrame } from './exr-export'

export const rafDriver = createRafDriver({ name: 'WorldView' })

export const useRenderer = ({
  project,
  sequence,
  fps = 30,
  bitrate = 10_000_000, // 10mbps
  bitrateMode,
  redraw,
}: {
  project: IProject
  sequence: ISequence
  fps?: number
  bitrate?: number
  bitrateMode: 'variable' | 'constant'
  redraw: () => void
}) => {
  // useVal keeps the prism "hot" and avoids cold prism warnings
  const sequenceLength = useVal(sequence.pointer.length)

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

      const projectName = project.address.projectId

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
              console.log('File picker cancelled by user for:', name)
            } else {
              console.error('Error in showSaveFilePicker for', name, ':', error)
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
          error: e => console.error(e),
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
          console.error('Unsupported codec configuration', config)
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

      await project.ready

      function getCanvasRecorder(canvas: HTMLCanvasElement) {
        const track = canvas.captureStream(0).getVideoTracks()[0]
        const mediaProcessor = new MediaStreamTrackProcessor({ track })
        const reader = mediaProcessor.readable.getReader()
        return { track, reader }
      }

      const mapContainer = await getContainer(`${projectName}-map`)
      if (!mapContainer) {
        setIsRendering(false)
        console.log('Render setup cancelled by user (map container).')
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
        sequence.position = simTime
        rafDriver.tick(performance.now())
        // redraw in case nothing changes due to theatre raf driver
        // TODO: Where should this go so that the first frame captures?
        redraw()

        currentFrame.current = i
        if (i % 10 === 0) console.log(`capturing frame ${i}/${endFrame} at simtime ${simTime}`)

        const canvasResult = await canvasFrameReady()

        if (canvasResult?.error) {
          console.error('Error capturing canvas frame:', canvasResult.error)
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
    [project, sequence, sequenceLength, fps, bitrate, bitrateMode, canvasFrameReady, redraw]
  )

  // Image sequence export - uses the same render loop as video capture but writes individual images
  const startSequenceCapture = useCallback(
    async ({
      canvas,
      getGLContext,
      directoryHandle,
      format = 'png',
      exrCompression = 'zip',
      includeDepth = false,
      startFrame = 0,
      endFrame = Math.floor(sequenceLength * fps),
      onFrameStart,
      onFrameComplete,
      onError,
    }: {
      canvas: HTMLCanvasElement
      getGLContext: () => WebGL2RenderingContext | null
      directoryHandle: FileSystemDirectoryHandle
      format?: ImageFormat
      exrCompression?: ExrCompression
      includeDepth?: boolean
      startFrame?: number
      endFrame?: number
      onFrameStart?: (frame: number, total: number) => void
      onFrameComplete?: (frame: number, total: number) => void
      onError?: (error: Error, frame: number) => void
    }) => {
      assert(canvas, 'canvas is required')
      assert(directoryHandle, 'directoryHandle is required')

      setIsRendering(true)

      const projectName = project.address.projectId
      const totalFrames = endFrame - startFrame + 1
      const padLength = Math.max(4, String(endFrame).length)
      const extension = format === 'exr' ? 'exr' : format === 'jpeg' ? 'jpg' : 'png'

      await project.ready

      for (let i = startFrame; i < endFrame + 1; i++) {
        onFrameStart?.(i - startFrame, totalFrames)

        try {
          // Set sequence position and render frame
          const simTime = i / fps
          sequence.position = simTime
          rafDriver.tick(performance.now())
          redraw()

          currentFrame.current = i
          console.log(`exporting frame ${i}/${endFrame} at simtime ${simTime}`)

          // Wait for frame to be ready
          const canvasResult = await canvasFrameReady()

          if (canvasResult?.error) {
            console.error('Error capturing canvas frame:', canvasResult.error)
            onError?.(canvasResult.error, i)
            continue
          }

          // Generate filename
          const frameNumber = String(i).padStart(padLength, '0')
          const filename = `${projectName}_${frameNumber}.${extension}`

          // Capture and write frame
          if (format === 'exr') {
            const gl = getGLContext()
            if (!gl) {
              throw new Error('WebGL context not available for EXR export')
            }

            const exrData = captureExrFrame(gl, canvas.width, canvas.height, {
              compression: exrCompression,
              includeDepth,
            })

            const fileHandle = await directoryHandle.getFileHandle(filename, { create: true })
            const writable = await fileHandle.createWritable()
            await writable.write(new Blob([exrData as unknown as BlobPart]))
            await writable.close()
          } else {
            // PNG or JPEG export
            const blob =
              format === 'jpeg'
                ? await captureJpegFrame(canvas, 0.92)
                : await capturePngFrame(canvas, 1)

            const fileHandle = await directoryHandle.getFileHandle(filename, { create: true })
            const writable = await fileHandle.createWritable()
            await writable.write(blob)
            await writable.close()
          }

          onFrameComplete?.(i - startFrame + 1, totalFrames)
        } catch (e) {
          const error = e instanceof Error ? e : new Error(String(e))
          onError?.(error, i)
          console.error(`Error exporting frame ${i}:`, error)
        }
      }

      setIsRendering(false)
    },
    [project, sequence, sequenceLength, fps, canvasFrameReady, redraw]
  )

  const [isRendering, setIsRendering] = useState(false)
  useEffect(() => {
    if (isRendering) {
      return
    }
    let tick: number
    const cb = () => {
      rafDriver.tick(performance.now())
      tick = requestAnimationFrame(cb)
    }
    tick = requestAnimationFrame(cb)
    return () => cancelAnimationFrame(tick)
  }, [isRendering])

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
