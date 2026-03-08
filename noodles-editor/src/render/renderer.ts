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
import { Float32ArrayPool } from './buffer-pool'
import {
  captureDepthFromDeckFBO,
  captureExrFrame,
  captureExrFrameFromImageData,
  imageDataToFloat32,
} from './exr-export'
import { ExrWorkerPool } from './exr-worker-pool'

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
      basemapEnabled = false,
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
      basemapEnabled?: boolean
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

      // Initialize buffer pool and worker pool for EXR encoding
      const bufferPool = format === 'exr' ? new Float32ArrayPool() : null
      const workerPool = format === 'exr' ? new ExrWorkerPool() : null
      const pendingEncodes: Promise<void>[] = []
      // Maximum pending encodes before applying backpressure
      const MAX_PENDING_ENCODES = 8

      // For EXR with depth: deck renders to canvas default FBO by default (depth as renderbuffer,
      // not readable). Create a custom FBO with a depth *texture* and set it as deck's render target.
      // biome-ignore lint/suspicious/noExplicitAny: accessing deck.gl/luma.gl private APIs
      let depthFBO: any = null
      // biome-ignore lint/suspicious/noExplicitAny: accessing deck.gl/luma.gl private APIs
      let originalFramebuffer: any
      const deck = getDeck?.()
      const gl = getGLContext?.()

      console.log(
        `[seq] startSequenceCapture: format=${format} includeDepth=${includeDepth} basemapEnabled=${basemapEnabled} hasDeck=${!!deck} hasGL=${!!gl}`
      )

      // Only use custom FBO for pure-deck scenes (no basemap). For basemap scenes, redirecting
      // deck's rendering to a custom FBO breaks the MapLibre/Deck.gl interleaving.
      if (format === 'exr' && includeDepth && !basemapEnabled && deck && gl) {
        // biome-ignore lint/suspicious/noExplicitAny: accessing deck.gl private APIs
        const device = (deck as any).device
        console.log(
          '[seq] deck.device:',
          device,
          'hasCreateFramebuffer:',
          !!device?.createFramebuffer
        )
        if (device?.createFramebuffer) {
          const width = canvas.width
          const height = canvas.height
          depthFBO = device.createFramebuffer({
            id: 'depth-capture-fbo',
            width,
            height,
            colorAttachments: ['rgba8unorm'],
            depthStencilAttachment: 'depth24plus',
          })
          // biome-ignore lint/suspicious/noExplicitAny: accessing deck.gl private APIs
          originalFramebuffer = (deck as any).props._framebuffer
          deck.setProps({ _framebuffer: depthFBO })
          console.log(`[seq] Created depth FBO ${width}x${height} for EXR capture`)
        }
      }

      // Use captureStream + requestFrame to read from the browser compositor rather than
      // the raw GL framebuffer. This works for both PNG and EXR because the compositor
      // persists the displayed frame, whereas gl.readPixels can read a cleared buffer
      // if another render cycle starts before the read (race condition with useDeckDrawLoop).
      const track = canvas.captureStream(0).getVideoTracks()[0]
      const reader = new MediaStreamTrackProcessor({ track }).readable.getReader()

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

            // When using depth FBO: blit color to canvas so captureStream captures it
            if (depthFBO && gl) {
              gl.bindFramebuffer(gl.READ_FRAMEBUFFER, depthFBO.handle)
              gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)
              gl.blitFramebuffer(
                0,
                0,
                canvas.width,
                canvas.height,
                0,
                0,
                canvas.width,
                canvas.height,
                gl.COLOR_BUFFER_BIT,
                gl.NEAREST
              )
              gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null)
            }

            // Capture depth - two paths depending on basemap mode
            let depth: Float32Array | null = null
            if (format === 'exr' && includeDepth && basemapEnabled && deck && gl) {
              // Basemap mode: do a second deck-only pass to capture depth
              // (The composite render already happened; we capture color from it, then render deck-only for depth)
              // biome-ignore lint/suspicious/noExplicitAny: accessing deck.gl private APIs
              const device = (deck as any).device
              if (device?.createFramebuffer) {
                const tempDepthFBO = device.createFramebuffer({
                  id: 'deck-only-depth-fbo',
                  width: canvas.width,
                  height: canvas.height,
                  colorAttachments: ['rgba8unorm'],
                  depthStencilAttachment: 'depth24plus',
                })

                // biome-ignore lint/suspicious/noExplicitAny: accessing deck.gl private APIs
                const prevFB = (deck as any).props._framebuffer
                deck.setProps({ _framebuffer: tempDepthFBO })

                // Render deck layers only to the temporary FBO
                deck.redraw()

                // Capture depth from deck-only pass
                depth = captureDepthFromDeckFBO(deck, gl, canvas.width, canvas.height)
                console.log(
                  '[seq] basemap deck-only depth:',
                  depth ? `${depth.length} floats` : 'null'
                )

                // Restore original state
                deck.setProps({ _framebuffer: prevFB ?? null })
                tempDepthFBO.destroy()
              }
            } else if (format === 'exr' && includeDepth && depthFBO && gl && deck) {
              // Pure-deck mode: depth already captured in the main render pass
              depth = captureDepthFromDeckFBO(deck, gl, canvas.width, canvas.height)
              console.log('[seq] depth capture:', depth ? `${depth.length} floats` : 'null')
            }

            const frameNumber = String(i).padStart(padLength, '0')
            const filename = `${projectName}_${frameNumber}.${extension}`

            if (pendingWrites.length >= MAX_CONCURRENT_WRITES) {
              await pendingWrites.shift()
            }

            // Read from compositor (display buffer) — works for both PNG and EXR
            // @ts-expect-error - typescript types not updated yet
            track.requestFrame()
            const { value: frame } = await reader.read()
            assert(frame, 'frame is required - might be a problem with the browser')
            const offscreen = new OffscreenCanvas(frame.displayWidth, frame.displayHeight)
            const ctx = offscreen.getContext('2d')!
            ctx.drawImage(frame, 0, 0)
            frame.close()

            if (format === 'exr' && workerPool && bufferPool) {
              // EXR: extract raw pixels, encode in worker pool (non-blocking)
              const imageData = ctx.getImageData(0, 0, offscreen.width, offscreen.height)
              debugRender(
                '[seq] EXR frame %d: imageData %dx%d, depth=%s',
                i,
                imageData.width,
                imageData.height,
                !!depth
              )

              // Acquire buffer from pool and convert pixels
              const rgbaBuffer = bufferPool.acquire(imageData.data.length)
              imageDataToFloat32(imageData, rgbaBuffer)

              // Copy depth to a pooled buffer (worker will transfer ownership)
              let depthBuffer: Float32Array | null = null
              if (depth) {
                depthBuffer = bufferPool.acquire(depth.length)
                depthBuffer.set(depth)
              }

              // Backpressure: wait if too many encodes pending
              if (pendingEncodes.length >= MAX_PENDING_ENCODES) {
                await pendingEncodes.shift()
              }

              // Queue encode in worker (non-blocking, buffers returned to pool after)
              const encodePromise = workerPool
                .encode(
                  offscreen.width,
                  offscreen.height,
                  rgbaBuffer,
                  depthBuffer,
                  exrCompression,
                  bufferPool
                )
                .then(exrData => {
                  // Wait for oldest file write if at limit
                  if (pendingWrites.length >= MAX_CONCURRENT_WRITES) {
                    return pendingWrites.shift()!.then(() => writeFile(filename, exrData))
                  }
                  const writePromise = writeFile(filename, exrData)
                  pendingWrites.push(writePromise)
                  return writePromise
                })

              pendingEncodes.push(encodePromise)
            } else if (format === 'exr') {
              // Fallback: synchronous encoding (shouldn't happen, but safe)
              const imageData = ctx.getImageData(0, 0, offscreen.width, offscreen.height)
              const exrData = captureExrFrameFromImageData(imageData, {
                compression: exrCompression,
                depth,
              })
              pendingWrites.push(writeFile(filename, exrData))
            } else {
              // PNG: encode to PNG blob
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

        // Wait for all pending encodes and writes to complete
        await Promise.all(pendingEncodes)
        await Promise.all(pendingWrites)
      } finally {
        if (reader) reader.releaseLock()
        // Cleanup worker pool and buffer pool
        workerPool?.terminate()
        bufferPool?.clear()
        // Restore original framebuffer and cleanup depth FBO
        if (depthFBO && deck) {
          deck.setProps({ _framebuffer: originalFramebuffer ?? null })
          depthFBO.destroy()
          console.log('[seq] Destroyed depth FBO')
        }
        setIsRendering(false)
      }
    },
    [projectName, sequenceLength, fps, redraw, canvasFrameReady]
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

    // Redraw to ensure buffer is populated, then capture
    const canvas = getBufferedCanvas()

    // Note: depth capture for single screenshots is not yet supported (requires custom FBO
    // which breaks basemap compositing). For now, just capture color.
    const exrData = captureExrFrame(gl, canvas.width, canvas.height, {
      compression: exrCompression,
      depth: null,
    })

    const fileWritableStream = await imageHandle.createWritable()
    await fileWritableStream.write(exrData)
    await fileWritableStream.close()
  } else {
    // PNG path
    const extension = '.png'
    const mimeType = 'image/png'

    const imageHandle = await window.showSaveFilePicker({
      suggestedName: `${suggestedName}${extension}`,
      types: [
        {
          description: 'PNG',
          accept: { [mimeType]: [extension] },
        },
      ],
    })

    // Redraw to ensure buffer is populated
    const canvas = getBufferedCanvas()

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        b => (b ? resolve(b) : reject(new Error('Canvas is empty'))),
        mimeType
      )
    })

    const fileWritableStream = await imageHandle.createWritable()
    await fileWritableStream.write(blob)
    await fileWritableStream.close()
  }
}
