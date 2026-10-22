// Guards for the export frame loops. An export records from one canvas for its whole run,
// so when that canvas is replaced partway through (adding or removing the basemap rebuilds
// it), the frame it waits for is never drawn and the export used to hang forever.

import { workerSetInterval, workerSetTimeout } from '../utils/worker-timer'

// Generous: with waitForData a frame waits for its layers' data to load
export const FRAME_READY_TIMEOUT_MS = 120_000
// Reading a drawn frame from a live canvas takes milliseconds
export const FRAME_READ_TIMEOUT_MS = 10_000
// How often a wait checks that the recorded canvas is still the one being drawn
const CANVAS_CHECK_MS = 250

export class CanvasReplacedError extends Error {
  constructor() {
    super(
      'The visualization was rebuilt during the export (for example, the basemap was added or removed), so the canvas being recorded is gone. Start the export again.'
    )
    this.name = 'CanvasReplacedError'
  }
}

export class FrameTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FrameTimeoutError'
  }
}

export interface CanvasGuard {
  // The canvas the export records from
  recording: HTMLCanvasElement
  // The canvas being drawn now
  getCanvas: () => HTMLCanvasElement | null | undefined
}

const isRecordedCanvas = ({ recording, getCanvas }: CanvasGuard) =>
  recording.isConnected && getCanvas() === recording

// Waits for a step of the frame loop (the frame being drawn, or read from the canvas).
// Rejects with CanvasReplacedError as soon as the recorded canvas is no longer the one
// being drawn, and with FrameTimeoutError if the step takes longer than timeoutMs.
export function guardFrameStep<T>(
  step: Promise<T>,
  guard: CanvasGuard,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  if (!isRecordedCanvas(guard)) return Promise.reject(new CanvasReplacedError())

  return new Promise<T>((resolve, reject) => {
    let settled = false
    const cancels: (() => void)[] = []
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      for (const cancel of cancels) cancel()
      fn()
    }
    cancels.push(
      workerSetTimeout(
        () => settle(() => reject(new FrameTimeoutError(timeoutMessage))),
        timeoutMs
      ),
      workerSetInterval(() => {
        if (!isRecordedCanvas(guard)) settle(() => reject(new CanvasReplacedError()))
      }, CANVAS_CHECK_MS)
    )
    step.then(
      value => settle(() => resolve(value)),
      error => settle(() => reject(error))
    )
  })
}
