import { assert } from '@deck.gl/core'
import { createRafDriver, onChange, type IProject, type ISequence, val } from '@theatre/core'
import {
  EncodedPacket,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  Output,
  StreamTarget,
} from 'mediabunny'
import { useCallback, useEffect, useRef, useState } from 'react'

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
  const [sequenceLength, setSequenceLength] = useState(() => val(sequence.pointer.length))

  useEffect(() => {
    const unsubscribe = onChange(sequence.pointer.length, length => {
      setSequenceLength(length)
    })
    return unsubscribe
  }, [sequence])

  const canvasRenderDone = useRef<(result?: { error?: Error }) => void>(() => { })
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
        console.log(`capturing frame ${i}/${endFrame} at simtime ${simTime}`)

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
          console.log('requesting frame')
          const result = await recorder.reader.read()
          const frame = result.value
          console.log('got frame', frame)

          assert(frame, 'frame is required - might be a problem with the browser')

          await container?.encodeFrame(frame)
          frame.close()
        }

        await addRecorderFrame(mapRecorder, mapContainer)
      }
      finishEncoding()
      setIsRendering(false)
    },
    [
      project,
      sequence,
      sequenceLength,
      fps,
      bitrate,
      bitrateMode,
      canvasFrameReady,
      redraw,
    ]
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

  // Used to trigger a re-render of the canvas in Deck when the render is stuck
  const [_animate, setAnimate] = useState(false)
  const advanceFrame = useCallback(() => {
    setAnimate(true)
    requestAnimationFrame(() => setAnimate(false))
  }, [])

  return {
    startCapture,
    captureFrame,
    currentFrame: currentFrame.current,
    advanceFrame,
    _animate,
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
