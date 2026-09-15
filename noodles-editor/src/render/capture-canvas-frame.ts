export async function captureCanvasFrame(
  track: MediaStreamTrack,
  reader: ReadableStreamDefaultReader<VideoFrame>,
  redraw: () => void
) {
  // captureStream(0) fulfills a request on the next canvas paint. Readiness
  // checks may leave the map idle, so request first, then paint again.
  ;(track as CanvasCaptureMediaStreamTrack).requestFrame()
  redraw()
  return reader.read()
}
