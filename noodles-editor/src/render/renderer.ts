import { assert } from '@deck.gl/core'
import {
  EncodedPacket,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  Output,
  StreamTarget,
} from 'mediabunny'
import { useCallback, useRef, useState } from 'react'
import { getTimelineStore, useTimelineStore } from '../timeline/timeline-store'
import { debugRender, debugRenderFrame } from '../utils/debug'
import { encodeWithAlpha, videoFrameToRGBA, type EncoderProgress } from './ffmpeg-encoder'

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
      exportAlpha = false,
      startFrame = 0,
      endFrame = Math.floor(sequenceLength * fps),
    }: {
      canvas: HTMLCanvasElement
      width: number
      height: number
      codec: 'hevc' | 'avc' | 'vp9' | 'av1'
      exportAlpha?: boolean
      startFrame?: number
      endFrame?: number
    }) => {
      assert(canvas, 'canvas is required')

      let i = startFrame

      setIsRendering(true)

      try {
        // Use FFmpeg for alpha export with compatible codecs (VP9/AV1)
        // WebCodecs alpha support is unreliable in current browsers
        const useFFmpeg = exportAlpha && (codec === 'vp9' || codec === 'av1')

        if (exportAlpha && (codec === 'avc' || codec === 'hevc')) {
          // Warn about incompatible codec and exit
          alert(
            `H.264 and H.265 codecs don't support transparency.\n\nSwitch to VP9 or AV1 codec to export with alpha channel.`
          )
          return
        }

        if (useFFmpeg) {
          // FFmpeg path: collect frames, then batch encode with alpha
          await captureWithFFmpeg({
            canvas,
            width,
            height,
            fps,
            bitrate,
            startFrame,
            endFrame,
            projectName,
            currentFrame,
            canvasFrameReady,
            redraw,
          })
        } else {
          // WebCodecs path: real-time encoding without alpha
          await captureWithWebCodecs({
            canvas,
            width,
            height,
            codec,
            fps,
            bitrate,
            bitrateMode,
            startFrame,
            endFrame,
            projectName,
            currentFrame,
            canvasFrameReady,
            redraw,
          })
        }
      } finally {
        setIsRendering(false)
        currentFrame.current = 0
        debugRender('Render finished, state reset')
      }
    },
    [projectName, sequenceLength, fps, bitrate, bitrateMode, canvasFrameReady, redraw]
  )

  const [isRendering, setIsRendering] = useState(false)

  return {
    startCapture,
    captureFrame,
    currentFrame: currentFrame.current,
    isRendering,
  }
}

export default useRenderer

// FFmpeg-based capture for alpha transparency
async function captureWithFFmpeg({
  canvas,
  width,
  height,
  fps,
  bitrate,
  startFrame,
  endFrame,
  projectName,
  currentFrame,
  canvasFrameReady,
  redraw,
}: {
  canvas: HTMLCanvasElement
  width: number
  height: number
  fps: number
  bitrate: number
  startFrame: number
  endFrame: number
  projectName: string
  currentFrame: React.MutableRefObject<number>
  canvasFrameReady: () => Promise<{ error?: Error } | undefined>
  redraw: () => void
}) {
  debugRender('Starting FFmpeg capture for alpha export')

  // Get file handle first so user can cancel before we start capturing
  // @ts-expect-error - showSaveFilePicker is a modern browser API not in TS types
  const fileHandle = await window.showSaveFilePicker({
    suggestedName: `${projectName}-map.webm`,
    types: [
      {
        description: 'WebM Video with Alpha',
        accept: { 'video/webm': ['.webm'] },
      },
    ],
  }).catch((error: Error) => {
    if (error.name === 'AbortError') {
      debugRender('File picker cancelled by user')
    } else {
      console.error('Error in showSaveFilePicker:', error)
    }
    return null
  })

  if (!fileHandle) {
    debugRender('FFmpeg capture cancelled by user')
    return
  }

  // Set up canvas recorder
  const track = canvas.captureStream(0).getVideoTracks()[0]
  const mediaProcessor = new MediaStreamTrackProcessor({ track })
  const reader = mediaProcessor.readable.getReader()

  // Collect all frames as RGBA data
  const frames: Uint8Array[] = []
  const totalFrames = endFrame - startFrame + 1

  try {
    for (let i = startFrame; i <= endFrame; i++) {
      const simTime = i / fps
      getTimelineStore().setPosition(simTime)
      redraw()

      currentFrame.current = i
      if (i % 10 === 0) {
        debugRenderFrame('Capturing frame %d/%d for FFmpeg', i, endFrame)
      }

      const canvasResult = await canvasFrameReady()

      if (canvasResult?.error) {
        throw new Error(`Frame capture failed: ${canvasResult.error.message}`)
      }

      // Request and read frame
      // @ts-expect-error - typescript types not updated yet
      track.requestFrame()
      const result = await reader.read()
      const frame = result.value as VideoFrame

      if (!frame) {
        throw new Error('Frame capture failed - might be a problem with the browser')
      }

      // Convert VideoFrame to RGBA
      const rgbaData = await videoFrameToRGBA(frame, width, height)
      frames.push(rgbaData)
      frame.close()
    }

    reader.releaseLock()
    debugRender('Collected %d frames, starting FFmpeg encode', frames.length)

    // Encode with FFmpeg
    const encodedData = await encodeWithAlpha(frames, {
      width,
      height,
      fps,
      bitrate,
      onProgress: (progress: EncoderProgress) => {
        if (progress.stage === 'encoding' || progress.stage === 'writing-frames') {
          debugRenderFrame('FFmpeg %s: %d%%', progress.stage, Math.round(progress.progress * 100))
        }
      },
    })

    // Write to file
    const fileWritableStream = await fileHandle.createWritable()
    await fileWritableStream.write(encodedData)
    await fileWritableStream.close()

    debugRender('FFmpeg capture complete, wrote %d bytes', encodedData.length)
  } catch (error) {
    try {
      reader.releaseLock()
    } catch {
      // Ignore cleanup errors
    }
    throw error
  }
}

// WebCodecs-based capture for non-alpha export (faster, real-time)
async function captureWithWebCodecs({
  canvas,
  width,
  height,
  codec,
  fps,
  bitrate,
  bitrateMode,
  startFrame,
  endFrame,
  projectName,
  currentFrame,
  canvasFrameReady,
  redraw,
}: {
  canvas: HTMLCanvasElement
  width: number
  height: number
  codec: 'hevc' | 'avc' | 'vp9' | 'av1'
  fps: number
  bitrate: number
  bitrateMode: 'variable' | 'constant'
  startFrame: number
  endFrame: number
  projectName: string
  currentFrame: React.MutableRefObject<number>
  canvasFrameReady: () => Promise<{ error?: Error } | undefined>
  redraw: () => void
}) {
  debugRender('Starting WebCodecs capture')

  let i = startFrame

  const getContainer = async (name: string) => {
    const extension = '.mp4'
    const mimeType = 'video/mp4'
    const containerFormat = new Mp4OutputFormat({ fastStart: 'in-memory' })

    // @ts-expect-error - showSaveFilePicker is a modern browser API not in TS types
    const fileHandle = await window.showSaveFilePicker({
      suggestedName: `${name}${extension}`,
      types: [
        {
          description: 'Video File',
          accept: { [mimeType]: [extension] },
        },
      ],
    }).catch((error: Error) => {
      if (error.name === 'AbortError') {
        debugRender('File picker cancelled by user for: %s', name)
      } else {
        console.error('Error in showSaveFilePicker for', name, ':', error)
      }
      return null
    })

    if (!fileHandle) {
      return null
    }
    const fileWritableStream = await fileHandle.createWritable()

    const output = new Output({
      format: containerFormat,
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
    let encoderError: Error | null = null
    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => {
        const timestamp = currentFrameIndex / fps
        const duration = 1 / fps
        const packet = EncodedPacket.fromEncodedChunk(chunk)
        const correctedPacket = packet.clone({ timestamp, duration })
        videoSource.add(correctedPacket, meta)
        currentFrameIndex++
      },
      error: e => {
        console.error('VideoEncoder error:', e)
        encoderError = e instanceof Error ? e : new Error(String(e))
      },
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
      const reason = `The ${codec.toUpperCase()} codec is not supported in this browser.\n\nTry switching to a different codec.`
      videoEncoder.close()
      throw new Error(reason)
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
      getEncoderError: () => encoderError,
    }
  }

  function getCanvasRecorder(canvasEl: HTMLCanvasElement) {
    const track = canvasEl.captureStream(0).getVideoTracks()[0]
    const mediaProcessor = new MediaStreamTrackProcessor({ track })
    const reader = mediaProcessor.readable.getReader()
    return { track, reader }
  }

  const mapContainer = await getContainer(`${projectName}-map`)
  if (!mapContainer) {
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

  async function cleanupOnError() {
    try {
      mapRecorder?.reader?.releaseLock()
    } catch {
      // Ignore cleanup errors
    }
    try {
      mapContainer?.videoEncoder.close()
    } catch {
      // Ignore cleanup errors
    }
    debugRender('Cleanup completed after error')
  }

  try {
    for (; i < endFrame + 1; i++) {
      const encoderError = mapContainer.getEncoderError()
      if (encoderError) {
        throw encoderError
      }

      const simTime = i / fps
      getTimelineStore().setPosition(simTime)
      redraw()

      currentFrame.current = i
      if (i % 10 === 0) {
        debugRenderFrame('capturing frame %d/%d at simtime %d', i, endFrame, simTime)
      }

      const canvasResult = await canvasFrameReady()

      if (canvasResult?.error) {
        console.error('Error capturing canvas frame:', canvasResult.error)
        throw new Error(`Frame capture failed: ${canvasResult.error.message}`)
      }

      const addRecorderFrame = async (
        recorder: ReturnType<typeof getCanvasRecorder>,
        container: Awaited<ReturnType<typeof getContainer>>
      ) => {
        // @ts-expect-error - typescript types not updated yet
        recorder.track.requestFrame()
        const result = await recorder.reader.read()
        const frame = result.value

        if (!frame) {
          throw new Error('Frame capture failed - might be a problem with the browser')
        }

        await container?.encodeFrame(frame)
        frame.close()
      }

      await addRecorderFrame(mapRecorder, mapContainer)
    }
    await finishEncoding()
  } catch (loopError) {
    await cleanupOnError()
    throw loopError
  }
}

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
