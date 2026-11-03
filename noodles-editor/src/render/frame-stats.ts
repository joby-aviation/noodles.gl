// Frames per second as actually drawn, counted from deck's onAfterRender. deck's own
// metrics.fps counts ticks of its animation loop, which MapLibre's interleaved overlay
// never runs, so it stays 0 with a basemap. The overlay also calls onAfterRender once per
// layer group within one map repaint, all in the same task, so only the first call in a
// task counts as a frame.

const WINDOW_MS = 1000

export interface FrameStats {
  // Frames drawn in the last second. A still scene that nothing redraws reads 0.
  fps: number
  // Milliseconds between the last two frames
  lastFrameTime: number
  // When the last frame was drawn (Date.now())
  timestamp: number
}

export class FrameCounter {
  private times: number[] = []
  private lastInterval = 0
  private countedThisTask = false

  frame(now = Date.now()) {
    if (this.countedThisTask) return
    this.countedThisTask = true
    queueMicrotask(() => {
      this.countedThisTask = false
    })

    const last = this.times.at(-1)
    if (last !== undefined) this.lastInterval = now - last
    this.times.push(now)
    this.prune(now)
  }

  // Undefined until the first frame is drawn
  stats(now = Date.now()): FrameStats | undefined {
    const last = this.times.at(-1)
    if (last === undefined) return undefined
    this.prune(now)
    return {
      fps: this.times.filter(t => t > now - WINDOW_MS).length,
      lastFrameTime: this.lastInterval,
      timestamp: last,
    }
  }

  // Keeps the last frame even when it is old, for lastFrameTime and timestamp
  private prune(now: number) {
    while (this.times.length > 1 && this.times[0] <= now - WINDOW_MS) this.times.shift()
  }
}
