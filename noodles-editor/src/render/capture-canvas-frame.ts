// Reads an export's frames through captureStream(0), which hands over what the compositor
// shows rather than the WebGL drawing buffer (cleared after each frame when
// preserveDrawingBuffer is false).
//
// Such a track captures the first paint after it is created, then the first paint after
// each requestFrame(), however much later that paint comes. A settled scene doesn't paint,
// so a request would wait for the next frame's redraw, which still shows the previous
// position. So the track is created at the first read, and each read asks for a frame and
// then repaints the scene: the frame it gets is the one on screen now.
export class CanvasFrameReader {
  private capture?: {
    track: CanvasCaptureMediaStreamTrack
    reader: ReadableStreamDefaultReader<VideoFrame>
  }

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly redraw: () => void
  ) {}

  // Reads the scene as it is drawn now. Throws when the canvas has cross-origin content.
  read(): Promise<ReadableStreamReadResult<VideoFrame>> {
    if (this.capture) {
      this.capture.track.requestFrame()
    } else {
      const track = this.canvas.captureStream(0).getVideoTracks()[0]
      this.capture = {
        track: track as CanvasCaptureMediaStreamTrack,
        reader: new MediaStreamTrackProcessor({ track }).readable.getReader(),
      }
    }
    this.redraw()
    return this.capture.reader.read()
  }

  // Drops a read still waiting for a frame, so a failed export lets go of the canvas
  async cancel() {
    await this.capture?.reader.cancel().catch(() => {})
  }

  stop() {
    this.capture?.reader.releaseLock()
    this.capture?.track.stop()
  }
}
