import { assert } from '@deck.gl/core'
import {
  EncodedPacket,
  EncodedVideoPacketSource,
  MkvOutputFormat,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  WebMOutputFormat,
} from 'mediabunny'
import { useCallback, useRef, useState } from 'react'
import { getTimelineStore, useTimelineStore } from '../timeline/timeline-store'

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
        // Warn if alpha export is requested with incompatible codec
        if (exportAlpha && (codec === 'avc' || codec === 'hevc')) {
          console.warn(
            `Alpha channel export is not supported with ${codec.toUpperCase()} codec. Please use VP9 or AV1 for transparency support.`
          )
          alert(
            `Warning: H.264 and H.265 codecs don't support transparency.\n\nSwitch to VP9 or AV1 codec to export with alpha channel.`
          )
        }

        const getContainer = async (name: string) => {
          // Determine file extension and container format based on codec and alpha
          let extension = '.mp4'
          let mimeType = 'video/mp4'
          let containerFormat: Mp4OutputFormat | WebMOutputFormat | MkvOutputFormat =
            new Mp4OutputFormat({ fastStart: 'in-memory' })

          if (exportAlpha) {
            if (codec === 'vp9') {
              extension = '.webm'
              mimeType = 'video/webm'
              containerFormat = new WebMOutputFormat()
            } else if (codec === 'av1') {
              extension = '.mkv'
              mimeType = 'video/x-matroska'
              containerFormat = new MkvOutputFormat()
            }
            // For avc/hevc, keep MP4 format but alpha won't work (already warned above)
          }

          const fileHandle = await window
            .showSaveFilePicker({
              suggestedName: `${name}${extension}`,
              types: [
                {
                  description: 'Video File',
                  accept: { [mimeType]: [extension] },
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
            ...(exportAlpha ? { alpha: 'keep' as const } : {}),
            ...codecMap[codec],
          } as const

          const { supported } = await VideoEncoder.isConfigSupported(config)

          if (!supported) {
            const reason = exportAlpha
              ? `Alpha (transparency) export is not supported in this browser for the ${codec.toUpperCase()} codec.\n\nTry switching to VP9 or AV1, or disable "Export with transparency".`
              : `The ${codec.toUpperCase()} codec is not supported in this browser.\n\nTry switching to a different codec.`
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
          getTimelineStore().setPosition(simTime)
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
      } finally {
        setIsRendering(false)
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
